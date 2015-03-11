/*
 * (C) Copyright 2014 Kurento (http://kurento.org/)
 *
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the GNU Lesser General Public License
 * (LGPL) version 2.1 which accompanies this distribution, and is available at
 * http://www.gnu.org/licenses/lgpl-2.1.html
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 */

var freeice  = require('freeice');
var inherits = require('inherits');

var EventEmitter = require('events').EventEmitter;

var recursive = require('merge').recursive


const MEDIA_CONSTRAINTS =
{
  audio: true,
  video:
  {
    mandatory:
    {
      maxWidth: 640,
      maxFrameRate: 15,
      minFrameRate: 15
    }
  }
}


function noop(error)
{
  if(error)
  {
    if(console.trace)
      return console.trace(error)

    console.error(error)
  }
}

function trackStop(track)
{
  track.stop && track.stop()
}

function streamStop(stream)
{
  stream.getTracks().forEach(trackStop)
}


/**
 * @classdesc Wrapper object of an RTCPeerConnection. This object is aimed to
 *            simplify the development of WebRTC-based applications.
 *
 * @constructor module:kurentoUtils.WebRtcPeer
 *
 * @param mode -
 *            {String} Mode in which the PeerConnection will be configured.
 *            Valid values are: 'recv', 'send', and 'sendRecv'
 * @param localVideo -
 *            {Object} Video tag for the local stream
 * @param remoteVideo -
 *            {Object} Video tag for the remote stream
 * @param onsdpoffer -
 *            {Function} Callback executed when a SDP offer has been generated
 * @param onerror -
 *            {Function} Callback executed when an error happens generating an
 *            SDP offer
 * @param videoStream -
 *            {Object} MediaStream to be used as primary source (typically video
 *            and audio, or only video if combined with audioStream) for
 *            localVideo and to be added as stream to the RTCPeerConnection
 * @param audioStream -
 *            {Object} MediaStream to be used as second source (typically for
 *            audio) for localVideo and to be added as stream to the
 *            RTCPeerConnection
 */
function WebRtcPeer(mode, options, callback)
{
  WebRtcPeer.super_.call(this)

  var localVideo, remoteVideo, onsdpoffer, onerror, mediaConstraints;
  var videoStream, audioStream, connectionConstraints;
  var pc, sendSource;

  var configuration = recursive(
  {
    iceServers: freeice()
  },
  WebRtcPeer.prototype.server);


  switch(mode)
  {
    case 'recv': mode = 'recvonly'; break
    case 'send': mode = 'sendonly'; break
  }


  while(arguments.length && !arguments[arguments.length-1]) arguments.length--;

  if(arguments.length > 3)  // Deprecated mode
  {
    console.warn('Positional parameters are deprecated for WebRtcPeer')

    localVideo       = arguments[1];
    remoteVideo      = arguments[2];
    onsdpoffer       = arguments[3];
    onerror          = arguments[4];
    mediaConstraints = arguments[5];
    videoStream      = arguments[6];
    audioStream      = arguments[7];
  }
  else
  {
    if(options instanceof Function)
    {
      callback = options
      options = undefined
    }

    options = options || {}

    localVideo       = options.localVideo;
    remoteVideo      = options.remoteVideo;
    onsdpoffer       = options.onsdpoffer;
    onerror          = options.onerror;
    onicecandidate   = options.onicecandidate;
    mediaConstraints = options.mediaConstraints;
    videoStream      = options.videoStream;
    audioStream      = options.audioStream;

    connectionConstraints = options.connectionConstraints;
    pc                    = options.peerConnection
    sendSource            = options.sendSource || 'webcam'

    configuration = recursive(configuration, options.configuration);
  }

  if(onerror)    this.on('error',    onerror);
  if(onsdpoffer) this.on('sdpoffer', onsdpoffer);
  if(onicecandidate) this.on('icecandidate', onicecandidate);

  var oncandidategatheringdone = options.oncandidategatheringdone;
  if(oncandidategatheringdone) this.on('candidategatheringdone', oncandidategatheringdone);


  // Init PeerConnection

  if(!pc) pc = new RTCPeerConnection(configuration);

  Object.defineProperty(this, 'peerConnection', {get: function(){return pc;}});

  var self = this;

  function onSdpOffer_callback(error, sdpAnswer, callback)
  {
    if(error) return console.error(error)

    self.processSdpAnswer(sdpAnswer, callback)
  }

  var candidategatheringdone = false
  pc.addEventListener('icecandidate', function(event)
  {
    if(event.candidate)
    {
      self.emit('icecandidate', event.candidate);
      candidategatheringdone = false
    }
    else if(!candidategatheringdone)
    {
      self.emit('candidategatheringdone');
      candidategatheringdone = true
    }
  });


  //
  // Priviledged methods
  //

  /**
  * @description This method creates the RTCPeerConnection object taking into
  *              account the properties received in the constructor. It starts
  *              the SDP negotiation process: generates the SDP offer and invokes
  *              the onsdpoffer callback. This callback is expected to send the
  *              SDP offer, in order to obtain an SDP answer from another peer.
  *
  * @function module:kurentoUtils.WebRtcPeer.prototype.start
  */
  this.start = function(constraints, callback)
  {
    if(videoStream && localVideo)
    {
      localVideo.src = URL.createObjectURL(videoStream);
      localVideo.muted = true;
    }

    if(videoStream) pc.addStream(videoStream);
    if(audioStream) pc.addStream(audioStream);

    // Adjust arguments

    if(constraints instanceof Function)
    {
      if(callback) throw new Error('Nothing can be defined after the callback')

      callback    = constraints
      constraints = undefined
    }

    // [Hack] https://code.google.com/p/chromium/issues/detail?id=443558
    if(mode == 'sendonly') mode = 'sendrecv';

    constraints = recursive(
    {
      mandatory:
      {
        OfferToReceiveAudio: (mode !== 'sendonly'),
        OfferToReceiveVideo: (mode !== 'sendonly')
      },
      optional:
      [
        {DtlsSrtpKeyAgreement: true}
      ]
    }, constraints);

    console.log('constraints: '+JSON.stringify(constraints));

    callback = (callback || noop).bind(this);


    // Create the offer with the required constraints

    pc.createOffer(function(offer)
    {
      console.log('Created SDP offer');

      pc.setLocalDescription(offer, function()
      {
        console.log('Local description set', offer);

        self.emit('sdpoffer', offer.sdp, onSdpOffer_callback);

        callback(null, self, offer.sdp);
      },
      callback);
    },
    callback, constraints);
  }


  callback = (callback || noop).bind(this)

  function getMedia(constraints)
  {
    getUserMedia(recursive(MEDIA_CONSTRAINTS, constraints), function(stream)
    {
      videoStream = stream;

      self.start(connectionConstraints, callback)
    },
    callback);
  }

  if(mode !== 'recvonly' && !videoStream && !audioStream)
  {
    if(sendSource && sendSource != 'webcam' && !mediaConstraints)
      getScreenConstraints(sendMode, function(error, constraints)
      {
        if(error) return callback(error)

        getMedia(constraints)
      })

    else
      getMedia(mediaConstraints)
  }
  else
    self.start(connectionConstraints, callback)


  this.on('_dispose', function()
  {
    if(localVideo)  localVideo.src  = '';
    if(remoteVideo) remoteVideo.src = '';
  })

  this.on('_processSdpAnswer', function(url)
  {
    if(remoteVideo)
    {
      remoteVideo.src = url;

      console.log('Remote URL:', url)
    }
  })
}
inherits(WebRtcPeer, EventEmitter)


WebRtcPeer.prototype.server = {}


Object.defineProperty(WebRtcPeer.prototype, 'enabled',
{
  enumerable: true,
  get: function()
  {
    return this.audioEnabled && this.videoEnabled;
  },
  set: function(value)
  {
    this.audioEnabled = this.videoEnabled = value
  }
})

function createEnableDescriptor(type)
{
  var method = 'get'+type+'Tracks'

  return {
    enumerable: true,
    get: function()
    {
      // [ToDo] Should return undefined if not all tracks have the same value?

      if(!this.peerConnection) return;

      var streams = this.peerConnection.getLocalStreams();
      if(!streams.length) return;

      for(var i=0,stream; stream=streams[i]; i++)
      {
        var tracks = stream[method]()
        for(var j=0,track; track=tracks[j]; j++)
          if(!track.enabled)
            return false;
      }

      return true;
    },
    set: function(value)
    {
      function trackSetEnable(track)
      {
        track.enabled = value;
      }

      this.peerConnection.getLocalStreams().forEach(function(stream)
      {
        stream[method]().forEach(trackSetEnable)
      })
    }
  }
}

Object.defineProperty(WebRtcPeer.prototype, 'audioEnabled', createEnableDescriptor('Audio'))
Object.defineProperty(WebRtcPeer.prototype, 'videoEnabled', createEnableDescriptor('Video'))


/**
 * Callback function invoked when an ICE candidate is received. Developers are
 * expected to invoke this function in order to complete the SDP negotiation.
 *
 * @function module:kurentoUtils.WebRtcPeer.prototype.addIceCandidate
 *
 * @param iceCandidate - Literal object with the ICE candidate description
 * @param callback - Called when the ICE candidate has been added.
 */
WebRtcPeer.prototype.addIceCandidate = function(iceCandidate, callback)
{
	var candidate = new RTCIceCandidate(iceCandidate);

	console.log('ICE candidate received');

	callback = (callback || noop).bind(this)

	this.peerConnection.addIceCandidate(candidate, callback, callback);
}

WebRtcPeer.prototype.getLocalStream = function(index)
{
  if(this.peerConnection)
    return this.peerConnection.getLocalStreams()[index || 0]
}

WebRtcPeer.prototype.getRemoteStream = function(index)
{
  if(this.peerConnection)
    return this.peerConnection.getRemoteStreams()[index || 0]
}

/**
* @description This method frees the resources used by WebRtcPeer.
*
* @function module:kurentoUtils.WebRtcPeer.prototype.dispose
*/
WebRtcPeer.prototype.dispose = function()
{
  console.log('Disposing WebRtcPeer');

  var pc = this.peerConnection;
  if(pc)
  {
    if(pc.signalingState == 'closed') return

    pc.getLocalStreams().forEach(streamStop)

    // FIXME This is not yet implemented in firefox
    // if(videoStream) pc.removeStream(videoStream);
    // if(audioStream) pc.removeStream(audioStream);

    pc.close();
  }

  this.emit('_dispose');
};


/**
 * Callback function invoked when a SDP answer is received. Developers are
 * expected to invoke this function in order to complete the SDP negotiation.
 *
 * @function module:kurentoUtils.WebRtcPeer.prototype.processSdpAnswer
 *
<<<<<<< HEAD
 * @param sdpAnswer -
 *            Description of sdpAnswer
 * @param callback -
 *            Invoked after the SDP answer is processed, or there is an error.
=======
 * @param sdpAnswer - Description of sdpAnswer
 * @param callback - Called when the remote description has been set
 *  successfully.
>>>>>>> efa1314... Trickle ICE
 */
WebRtcPeer.prototype.processSdpAnswer = function(sdpAnswer, callback)
{
  var answer = new RTCSessionDescription(
  {
    type : 'answer',
    sdp : sdpAnswer,
  });

  console.log('SDP answer received, setting remote description');

  callback = (callback || noop).bind(this)

  var pc = this.peerConnection;
  if(pc.signalingState == 'closed')
    return callback('PeerConnection is closed')

  var self = this;

  pc.setRemoteDescription(answer, function()
  {
    var stream = pc.getRemoteStreams()[0]

    var url = stream ? URL.createObjectURL(stream) : "";

    self.emit('_processSdpAnswer', url);

    callback();
  },
  callback);
}


//
// Static factory functions
//

/**
 * @description This method creates the WebRtcPeer object and obtain userMedia
 *              if needed.
 *
 * @function module:kurentoUtils.WebRtcPeer.start
 *
 * @param mode -
 *            {String} Mode in which the PeerConnection will be configured.
 *            Valid values are: 'recv', 'send', and 'sendRecv'
 * @param localVideo -
 *            {Object} Video tag for the local stream
 * @param remoteVideo -
 *            {Object} Video tag for the remote stream
 * @param onSdp -
 *            {Function} Callback executed when a SDP offer has been generated
 * @param onerror -
 *            {Function} Callback executed when an error happens generating an
 *            SDP offer
 * @param mediaConstraints -
 *            {Object[]} Constraints used to create RTCPeerConnection
 * @param videoStream -
 *            {Object} MediaStream to be used as primary source (typically video
 *            and audio, or only video if combined with audioStream) for
 *            localVideo and to be added as stream to the RTCPeerConnection
 * @param videoStream -
 *            {Object} MediaStream to be used as primary source (typically video
 *            and audio, or only video if combined with audioStream) for
 *            localVideo and to be added as stream to the RTCPeerConnection
 * @param audioStream -
 *            {Object} MediaStream to be used as second source (typically for
 *            audio) for localVideo and to be added as stream to the
 *            RTCPeerConnection
 *
 * @return {module:kurentoUtils.WebRtcPeer}
 */
WebRtcPeer.start = function(mode, localVideo, remoteVideo, onsdpoffer, onerror,
    mediaConstraints, videoStream, audioStream, configuration,
    connectionConstraints, callback)
{
  var options =
  {
    localVideo      : localVideo,
    remoteVideo     : remoteVideo,
    onsdpoffer      : onsdpoffer,
    onerror         : onerror,
    mediaConstraints: mediaConstraints,
    videoStream     : videoStream,
    audioStream     : audioStream,
    configuration   : configuration,

    connectionConstraints: connectionConstraints
  };

  return new WebRtcPeer(mode, options, callback);
};

/**
 * @description This methods creates a WebRtcPeer to receive video.
 *
 * @function module:kurentoUtils.WebRtcPeer.startRecvOnly
 *
 * @param remoteVideo -
 *            {Object} Video tag for the remote stream
 * @param onSdp -
 *            {Function} Callback executed when a SDP offer has been generated
 * @param onerror -
 *            {Function} Callback executed when an error happens generating an
 *            SDP offer
 * @param mediaConstraints -
 *            {Object[]} Constraints used to create RTCPeerConnection
 *
 * @return {module:kurentoUtils.WebRtcPeer}
 */
WebRtcPeer.startRecvOnly = function(remoteVideo, onSdp, onError,
  mediaConstraints, configuration, connectionConstraints, callback)
{
  return WebRtcPeer.start('recvonly', null, remoteVideo, onSdp, onError,
      mediaConstraints, null, null, configuration, connectionConstraints,
      callback);
};

/**
 * @description This methods creates a WebRtcPeer to send video.
 *
 * @function module:kurentoUtils.WebRtcPeer.startSendOnly
 *
 * @param localVideo -
 *            {Object} Video tag for the local stream
 * @param onSdp -
 *            {Function} Callback executed when a SDP offer has been generated
 * @param onerror -
 *            {Function} Callback executed when an error happens generating an
 *            SDP offer
 * @param mediaConstraints -
 *            {Object[]} Constraints used to create RTCPeerConnection
 *
 * @return {module:kurentoUtils.WebRtcPeer}
 */
WebRtcPeer.startSendOnly = function(localVideo, onSdp, onError,
  mediaConstraints, configuration, connectionConstraints, callback)
{
  return WebRtcPeer.start('sendonly', localVideo, null, onSdp, onError,
      mediaConstraints, null, null, configuration, connectionConstraints,
      callback);
};

/**
 * @description This methods creates a WebRtcPeer to send and receive video.
 *
 * @function module:kurentoUtils.WebRtcPeer.startSendRecv
 *
 * @param localVideo -
 *            {Object} Video tag for the local stream
 * @param remoteVideo -
 *            {Object} Video tag for the remote stream
 * @param onSdp -
 *            {Function} Callback executed when a SDP offer has been generated
 * @param onerror -
 *            {Function} Callback executed when an error happens generating an
 *            SDP offer
 * @param mediaConstraints -
 *            {Object[]} Constraints used to create RTCPeerConnection
 *
 * @return {module:kurentoUtils.WebRtcPeer}
 */
WebRtcPeer.startSendRecv = function(localVideo, remoteVideo, onSdp, onError,
  mediaConstraints, configuration, connectionConstraints, callback)
{
  return WebRtcPeer.start('sendrecv', localVideo, remoteVideo, onSdp,
      onError, mediaConstraints, null, null, configuration,
      connectionConstraints, callback);
};


//
// Specialized child classes
//

function WebRtcPeerRecvonly(options, callback)
{
  WebRtcPeerRecvonly.super_.call(this, 'recvonly', options, callback)
}
inherits(WebRtcPeerRecvonly, WebRtcPeer)

function WebRtcPeerSendonly(options, callback)
{
  WebRtcPeerSendonly.super_.call(this, 'sendonly', options,callback)
}
inherits(WebRtcPeerSendonly, WebRtcPeer)

function WebRtcPeerSendrecv(options, callback)
{
  WebRtcPeerSendrecv.super_.call(this, 'sendrecv', options, callback)
}
inherits(WebRtcPeerSendrecv, WebRtcPeer)


module.exports = WebRtcPeer;

WebRtcPeer.WebRtcPeer         = WebRtcPeer;
WebRtcPeer.WebRtcPeerRecvonly = WebRtcPeerRecvonly;
WebRtcPeer.WebRtcPeerSendonly = WebRtcPeerSendonly;
WebRtcPeer.WebRtcPeerSendrecv = WebRtcPeerSendrecv;
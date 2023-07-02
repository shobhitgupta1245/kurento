/*
 * Copyright 2018 Kurento (https://www.kurento.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.kurento.tutorial.helloworld;

import org.kurento.client.KurentoClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpHeaders;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

/**
 * Kurento Java Tutorial - Application entry point.
 */
@SpringBootApplication
@EnableWebSocket
public class HelloWorldApp implements WebSocketConfigurer
{
  private static final Logger log = LoggerFactory.getLogger(Application.class);
  
  @Bean
  public HelloWorldHandler handler()
  {
    return new HelloWorldHandler();
  }

  @Bean
  public KurentoClient kurentoClient()
  {
    return KurentoClient.create();
  }

  @Bean
  public ServletServerContainerFactoryBean createServletServerContainerFactoryBean() {
    ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
    container.setMaxTextMessageBufferSize(32768);
    return container;
  }

  @Override
  public void registerWebSocketHandlers(WebSocketHandlerRegistry registry)
  {
    registry.addHandler(handler(), "/helloworld")
      .addInterceptors(new HandshakeInterceptor() {
                    @Override
                    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                                   WebSocketHandler wsHandler, Map<String, Object> attributes)
                            throws Exception {
                        if (request instanceof ServletServerHttpRequest) {
                            ServletServerHttpRequest servletRequest = (ServletServerHttpRequest) request;
                            HttpHeaders headers = servletRequest.getHeaders();
                            if (headers.containsKey(HttpHeaders.COOKIE) && headers.get(HttpHeaders.COOKIE).contains("awsappcookie")) {
                                log.info("Request already contains cookie header, path - {}", servletRequest.getURI().getPath());
                            } else {
                                if (response instanceof ServletServerHttpResponse) {
                                    ServletServerHttpResponse servletResponse = (ServletServerHttpResponse) response;
                                    HttpHeaders responseHeaders = servletResponse.getHeaders();
                                    responseHeaders.add(HttpHeaders.SET_COOKIE, "awsappcookie="+System.currentTimeMillis());
                                    attributes.put("headers", responseHeaders);
                                    log.info("Cookie header is added to response, path - {}", servletRequest.getURI().getPath());
                                }
                            }
                        }
                        return true;
                    }

                    @Override
                    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                               WebSocketHandler wsHandler, Exception ex) {
                        // No need for implementation
                    }
                });
  }

  public static void main(String[] args) throws Exception
  {
    SpringApplication.run(HelloWorldApp.class, args);
  }
}

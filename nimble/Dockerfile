FROM --platform=linux/amd64 ubuntu:noble

RUN apt-get update && apt-get install -y apt-utils dnsutils adduser curl
RUN curl -o /etc/apt/sources.list.d/nimble.sources https://nimblestreamer.com/ubuntu/nimble.sources
RUN apt-get update && apt-get install -y nimble nimble-srt

EXPOSE 8081 8443 1935 1554

CMD ["/usr/bin/nimble", "--conf-dir=/etc/nimble", "--log-dir=/var/log/nimble"]

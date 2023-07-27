# Prometheus / Grafana stack

Start the Prometheus / Grafana docker stack with:
```sh
cd prometheus-stack
docker-compose up
```

The docker-compose services are started inside the local docker network `192.168.1.0/24`. The host services can be accessed at `192.168.1.1`.

Docker services:
- Prometheus web interface: http://localhost:9090
- Pushgateway: http://localhost:9091
- Grafana web interface: http://localhost:3000 (user:pass `admin`:`admin`)

Scrape configuration:
- prometheus (`localhost:9090`) and node-exporter (`192.168.1.1:9100`) metrics
- process-exporter metrics (`process-exporter:9256`) used for collecting mediasoup-worker processes stats
- pushgateway metrics

To collect statistics from webrtcperf, start the tool with the
option: `--prometheus-pushgateway=http://localhost:9091`
and (optionally): `--prometheus-pushgateway-job-name=<JOB_NAME>`.

WebRTCPerf dashboard (http://127.0.0.1:3001/d/webrtcperf/webrtcperf).

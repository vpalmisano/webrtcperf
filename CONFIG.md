# Configuration

The configuration properties are applied in the following order (from higher to 
lower precedence):

- arguments passed to the executable in kebab case (e.g. `url-query`);
- environment variables in uppercase snake format (e.g. `URL_QUERY`);
- `config.json` configuration file;
- default values.

| Name | Description | Format | Default value |
| :--- | :---------- | :----- | :------------ |
| url | The page url to load (mandatory). | `"string"` | ``""`` |
| urlQuery | The query string to append to the page url; the following template variables are replaced: `$p` the process pid, `$s` the session index, `$S` the total sessions, `$t` the tab index, `$T` the total tabs per session, `$i` the tab absolute index. | `"string"` | ``""`` |
| videoPath | A javascript file path; if set, the file content will be injected inside the DOM of each opened tab page; the following global variables are attached to the `window` object: `WEBRTC_STRESS_TEST_SESSION` the session number; `WEBRTC_STRESS_TEST_TAB` the tab number inside the session; `WEBRTC_STRESS_TEST_INDEX` the tab absolute index. | `"string"` | ``""`` |
| videoWidth | The fake video resize width. | `"nat"` | ``1280`` |
| videoHeight | The fake video resize height. | `"nat"` | ``720`` |
| videoFramerate | The fake video framerate. | `"nat"` | ``25`` |
| videoSeek | The fake audio/video seek position in seconds. | `"nat"` | ``0`` |
| videoDuration | The fake audio/video duration in seconds. | `"nat"` | ``120`` |
| videoCacheRaw | If the temporary video and audio raw files can be reused across multiple runs. | `"boolean"` | ``true`` |
| videoCachePath | The path where the video and audio raw files are stored. | `"string"` | ``"/tmp/webrtc-stress-test"`` |
| videoFormat | The fake video file format presented to the browser. | `[  "y4m",  "mjpeg"]` | ``"y4m"`` |
| chromiumPath | The Chromium executable path. | `"string"` | ``"/usr/bin/chromium-browser-unstable"`` |
| windowWidth | The browser window width. | `"nat"` | ``1920`` |
| windowHeight | The browser window height. | `"nat"` | ``1080`` |
| useNullVideoDecoder | Disables the video decoding. This affects the RTC video jitter buffer stats. | `"boolean"` | ``false`` |
| display | If set to a valid Xserver `DISPLAY` string, the headless mode is disabled. | `"string"` | ``null`` |
| audioRedForOpus | Enables RED for OPUS codec (experimental). | `"boolean"` | ``false`` |
| sessions | The number of browser sessions to start. | `"nat"` | ``1`` |
| tabsPerSession | The number of tabs to open in each browser session. | `"nat"` | ``1`` |
| spawnPeriod | The sessions spawn period in ms. | `"nat"` | ``1000`` |
| enablePageLog |  If `true`, the pages logs will be printed on console. | `"boolean"` | ``false`` |
| showStats | If the statistics should be displayed on the console output. | `"boolean"` | ``true`` |
| statsPath | The log file directory path; if set, the log data will be written in a .csv file inside this directory; if the directory path does not exist, it will be created. | `"string"` | ``""`` |
| statsInterval | The log interval in seconds. | `"nat"` | ``2`` |
| enableRtcStats | Enables the collection of RTC stats using ObserveRTC. | `"boolean"` | ``true`` |
| rtcStatsTimeout | The timeout in seconds after wich the RTC stats coming from inactive streams are removed. | `"nat"` | ``30`` |
| scriptPath | A javascript file path; if set, the file content will be injected inside the DOM of each opened tab page; the following global variables are attached to the `window` object: `WEBRTC_STRESS_TEST_SESSION` the session number; `WEBRTC_STRESS_TEST_TAB` the tab number inside the session; `WEBRTC_STRESS_TEST_INDEX` the tab absolute index. | `"string"` | ``""`` |
| preloadScriptPath | A javascript file path to be preloaded to each  opened tab page. | `"string"` | ``""`` |
| getUserMediaOverrides | A JSON string with the `getUserMedia` constraints to override for each tab in each session; e.g. `[null, {"video": {"width": 360, "height": 640}}]` overrides the `video` settings for the second tab in the first session. | `"array"` | ``null`` |
| runDuration | If greater than 0, the test will stop after the provided number of seconds. | `"nat"` | ``0`` |
| throttleConfig | A JSON string with a valid [sitespeedio/throttle](https://github.com/sitespeedio/throttle#use-directly-in-nodejs) configuration (e.g. `{"up": 1000, "down": 1000, "rtt": 200}`). When used with docker, run `sudo modprobe ifb numifbs=1` first and add the `--cap-add=NET_ADMIN` docker option. | `"*"` | ``null`` |


---

*Document generated with:* `yarn generate-config-docs`

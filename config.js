module.exports = {
    URL: process.env.URL,
    VIDEO_PATH: process.env.VIDEO_PATH || './video.mp4',
    VIDEO_WIDTH: parseInt(process.env.VIDEO_WIDTH || 1280),
    VIDEO_HEIGHT: parseInt(process.env.VIDEO_HEIGHT || 720),
    VIDEO_FRAMERATE: parseInt(process.env.VIDEO_FRAMERATE || 25),
    PUBLISH_VIDEO: process.env.PUBLISH_VIDEO !== 'false',
    PUBLISH_AUDIO: process.env.PUBLISH_AUDIO !== 'false',
    //
    WINDOW_WIDTH: parseInt(process.env.WINDOW_WIDTH || 1920),
    WINDOW_HEIGHT: parseInt(process.env.WINDOW_HEIGHT || 1080),
    //
    WORKERS: parseInt(process.env.WORKERS || 1),
    SESSIONS_PER_WORKER: parseInt(process.env.SESSIONS_PER_WORKER || 1),
    TABS_PER_SESSION: parseInt(process.env.TABS_PER_SESSION || 1),
    SPAWN_PERIOD: parseInt(process.env.SPAWN_PERIOD || 1000),
    SHOW_STATS: process.env.SHOW_STATS !== 'false',
    LOG_PATH: process.env.LOG_PATH,
    LOG_INTERVAL: parseInt(process.env.LOG_INTERVAL || 1),
    //
    SCRIPT_PATH: process.env.SCRIPT_PATH || null,
}
import compression from 'compression'
import express, { json } from 'express'
import basicAuth from 'express-basic-auth'
import fs from 'fs'
import { createServer, Server as HttpServer } from 'http'
import { createServer as _createServer, Server as HttpsServer } from 'https'
import os from 'os'
import path from 'path'
import tar from 'tar-fs'
import zlib from 'zlib'

import { loadConfig } from './config'
import { Session, SessionParams } from './session'
import { Stats } from './stats'
import { logger, runShellCommand } from './utils'

const log = logger('app:server')

/**
 * An HTTP server instance that allows to control the tool using a REST
 * interface. Moreover, it allows to aggregate stats data coming from multiple
 * running tool instances.
 */
export class Server {
  /** The server listening port. */
  readonly serverPort: number
  /** The basic auth secret. */
  readonly serverSecret: string
  /** If HTTPS protocol should be used. */
  readonly serverUseHttps: boolean
  /** An optional path that the HTTP server will expose with the /data endpoint. */
  readonly serverData: string
  /** The file path that will be used to serve the \`/view/page.log\` requests. */
  pageLogPath: string
  /** A {@link Stats} class instance. */
  stats: Stats

  private app: express.Express
  private server: HttpServer | HttpsServer | null = null

  /**
   * Server instance.
   * All the HTTP endpoints are protected by basic authentication with user
   * `admin` and password {@link Server.serverSecret}.
   * @param serverPort The server listening port.
   * @param serverSecret The basic auth secret.
   * @param serverUseHttps If HTTPS protocol should be used.
   * @param serverData An optional path that the HTTP server will expose with the /data endpoint.
   * @param pageLogPath The file path that will be used to serve the \`/view/page.log\` requests.
   * @param stats A {@link Stats} class instance.
   */
  constructor(
    {
      serverPort = 5000,
      serverSecret = 'secret',
      serverUseHttps = false,
      serverData = '',
      pageLogPath = '',
    } = {},
    stats: Stats,
  ) {
    this.serverPort = serverPort
    this.serverSecret = serverSecret
    this.serverUseHttps = serverUseHttps
    this.serverData = serverData
    this.pageLogPath = pageLogPath
    this.stats = stats
    //
    this.app = express()
    this.app.use(compression())
    this.app.use(
      json({
        limit: '10mb',
      }),
    )

    this.app.use(
      basicAuth({
        challenge: true,
        users: { admin: this.serverSecret },
      }),
    )

    this.app.get('/', (_req, res) => {
      res.send('')
    })

    this.app.get('/stats', this.getStats.bind(this))
    this.app.get('/collected-stats', this.getCollectedStats.bind(this))
    this.app.get('/screenshot/:sessionId', this.getScreenshot.bind(this))
    this.app.put('/collected-stats', this.putCollectedStats.bind(this))
    this.app.put('/session', this.putSession.bind(this))
    this.app.put('/sessions', this.putSessions.bind(this))
    this.app.delete('/session', this.deleteSession.bind(this))
    this.app.delete('/sessions', this.deleteSessions.bind(this))
    this.app.get('/view/page.log', this.getPageLog.bind(this))
    this.app.get('/view/docker.log', this.getDockerLog.bind(this))
    this.app.get('/download/alert-rules', this.getAlertRules.bind(this))
    this.app.get('/download/stats', this.getStatsFile.bind(this))
    this.app.get('/empty-page', this.getEmptyPage.bind(this))
    if (this.serverData) {
      this.app.get('/data/*', this.getData.bind(this))
    }

    this.app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        log.error(`request error: ${err.message}`)
        res.status(500).send(err.message)
      },
    )

    // WS interface
    /* this.io = new Server(this.server);
    this.io.use((socket, next) => {
      if (socket.handshake.auth.token === this.serverSecret) {
        return next();
      }
      log.error(`invalid auth: ${socket.handshake.auth.token}`);
      next(new Error('Authentication error'));
    });
    this.io.on('connection', this.onConnection.bind(this)); */
  }

  /*
   * onConnection
   * @param {Socket} socket
   */
  /* onConnection(socket) {
    log.debug('onConnection', socket);

    socket.on('disconnect', () => {
      log.debug('io socket disconnected');
    });

    socket.on('message', (msg) => {
      log.debug('message', msg);
    });
  } */

  /**
   * GET /stats endpoint.
   *
   * Returns a JSON array of the last statistics for each running Session.
   */
  private async getStats(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> {
    log.debug(`GET /stats`)
    const stats = []
    try {
      for (const session of this.stats.sessions.values()) {
        stats.push(session.stats)
      }
      res.json(stats)
    } catch (err) {
      next(err)
    }
  }

  /**
   * GET /download/stats endpoint.
   *
   * Returns the {@link Stats.statsWriter} file content.
   */
  private getStatsFile(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    log.debug(`/download/stats`, req.query)
    if (!this.stats.statsWriter) {
      return next(new Error('statsPath not set'))
    }
    res.download(this.stats.statsWriter.fname)
  }

  /**
   * GET /collected-stats endpoint.
   *
   * Returns a JSON array of the last statistics collected from external running
   * tools.
   */
  private getCollectedStats(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    log.debug(`GET /collected-stats`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats: Record<string, any> = {}
    try {
      for (const [key, stat] of Object.entries(this.stats.collectedStats)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        stats[key] = (stat as any).data
      }
      res.json(stats)
    } catch (err) {
      next(err)
    }
  }

  /**
   * GET /screenshot/<sessionID> endpoint.
   *
   * Returns the page screenshot running inside the {@link Session} identified
   * by `sessionID`.
   * Additional query params:
   * - `page`: the page number (starting from `0`) running inside the {@link Session}.
   * - `format`: the image format (`jpeg`, `png`, `webp`). Default: `webp`.
   */
  private async getScreenshot(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> {
    const sessionId = parseInt(req.params.sessionId)
    const pageId = parseInt((req.query.page as string) || '0')
    const format = (req.query.format as string) || 'webp'
    log.debug(`GET /screenshot/${sessionId} page=${pageId} format=${format}`)
    try {
      const session = this.stats.sessions.get(sessionId)
      if (!session) {
        throw new Error(`Session not found: "${sessionId}"`)
      }
      const filePath = await session.pageScreenshot(pageId, format)
      res.sendFile(path.resolve(filePath))
    } catch (err) {
      next(err)
    }
  }

  /**
   * PUT /collected-stats endpoint.
   *
   * Allows to inject {@link Stats} metrics coming from an external tool.
   */
  private putCollectedStats(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    log.debug(`PUT /collected-stats`)
    const { id, stats, config } = req.body
    try {
      this.stats.addExternalCollectedStats(id, stats, config)
      res.json({
        message: `Collected stats added`,
      })
    } catch (err) {
      next(err)
    }
  }

  /**
   * PUT /session endpoint.
   *
   * Starts a new {@link Session}.
   * The request body format will be parsed as a {@link SessionParams} object.
   */
  private async putSession(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> {
    log.debug(`PUT /session`, req.body)
    try {
      const id = this.stats.consumeSessionId()
      await this.startLocalSession(id, req.body)
      res.json({
        message: `Session created`,
        data: { id },
      })
    } catch (err) {
      next(err)
    }
  }

  /**
   * PUT /sessions endpoint.
   *
   * Starts multiple {@link Session} instances as specified into the
   * `body.sessions` value.
   * The request body will be parsed as a {@link SessionParams} object.
   */
  private async putSessions(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> {
    log.debug(`PUT /sessions`, req.body)
    try {
      const { sessions } = req.body
      const sessionsIds = []
      for (let i = 0; i < sessions; i++) {
        const id = this.stats.sessions.size
        await this.startLocalSession(id, req.body)
        sessionsIds.push(id)
      }
      res.json({
        message: `${sessions} sessions created`,
        data: { ids: sessionsIds },
      })
    } catch (err) {
      next(err)
    }
  }

  /**
   * DELETE /session endpoint.
   *
   * Delete the {@link Session} instance identified by the `body.id` param.
   */
  private async deleteSession(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> {
    log.debug(`DELETE /session`, req.body)
    try {
      const { id } = req.body
      await this.stopLocalSession(id)
      res.json({
        message: `Session deleted`,
        data: { id },
      })
    } catch (err) {
      next(err)
    }
  }

  /**
   * DELETE /sessions endpoint.
   *
   * Delete the {@link Session} instances specified by the `body.ids` array.
   */
  private async deleteSessions(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> {
    log.debug(`DELETE /sessions`, req.body)
    try {
      const { ids } = req.body
      for (const id of ids) {
        await this.stopLocalSession(id)
      }
      res.json({
        message: `${ids.length} sessions deleted`,
        data: { ids },
      })
    } catch (err) {
      next(err)
    }
  }

  /**
   * GET /view/page.log endpoint.
   *
   * Returns the page log file content as specified in {@link Config} `pageLogPath`.
   */
  private getPageLog(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    log.debug(`GET /view/page.log`, req.query)
    if (!this.pageLogPath) {
      return next(new Error('pageLogPath not set'))
    }
    if (req.query.range && !req.headers.range) {
      req.headers.range = `bytes=${req.query.range}`
    }
    res.sendFile(path.resolve(this.pageLogPath))
  }

  /**
   * GET /view/docker.log endpoint.
   *
   * Returns the Docker logs related to the container running the tool.
   * It requires to run the Docker container with the following options:
   * ```
     --cidfile /tmp/docker.id
     -v /tmp/docker.id:/root/.webrtcperf/docker.id:ro
     -v /var/lib/docker:/var/lib/docker:ro
   * ```
   */
  private async getDockerLog(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> {
    log.debug(`GET /view/docker.log`, req.query)
    try {
      const containerId = await fs.promises.readFile(
        `${os.homedir()}/.webrtcperf/docker.id`,
        'utf-8',
      )
      const logPath = `/var/lib/docker/containers/${containerId}/${containerId}-json.log`
      if (req.query.range && !req.headers.range) {
        req.headers.range = `bytes=${req.query.range}`
      }
      res.sendFile(path.resolve(logPath))
    } catch (err) {
      next(err)
    }
  }

  /**
   * GET /download/alert-rules endpoint.
   *
   * Downloads the alert rules report stored into the {@link Stats.alertRulesFilename}.
   */
  private getAlertRules(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    log.debug(`GET /download/alert-rules`, req.query)
    if (!this.stats.alertRulesFilename) {
      return next(new Error('Stats alertRulesFilename not set'))
    }
    res.download(this.stats.alertRulesFilename)
  }

  /**
   * GET /empty-page endpoint.
   *
   * Returns an empty HTML page. Useful for running tests with raw Javascript
   * content without any DOM rendering.
   */
  private getEmptyPage(req: express.Request, res: express.Response): void {
    log.debug(`GET /empty-page`, req.query)
    res.send(`<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Empty Page</title>
</head>
<body>
</body>
</html>`)
  }

  /**
   * GET /data/* endpoint.
   *
   * Returns the file content relative to the {@link Config} `serverData` path.
   * If the requested path points to a directory, it returns the directory
   * content in tar.gz format.
   */
  private getData(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    const paramPath = path
      .normalize(req.params[0])
      .replace(/^(\.\.(\/|\\|$))+/, '')
    log.debug(`GET /data/${paramPath}`, req.query)
    const fpath = path.resolve(this.serverData, paramPath)
    if (!fs.existsSync(fpath)) {
      return next(new Error(`${paramPath} not found`))
    }
    if (fs.lstatSync(fpath).isDirectory()) {
      res.header(
        'Content-Disposition',
        `attachment; filename="${path.basename(fpath)}.tar.gz"`,
      )
      res.setHeader('content-type', 'application/gzip')
      tar.pack(fpath).pipe(zlib.createGzip()).pipe(res)
    } else {
      if (req.query.range && !req.headers.range) {
        req.headers.range = `bytes=${req.query.range}`
      }
      res.sendFile(fpath)
    }
  }

  /**
   * Starts a new {@link Session} instance.
   * @param id The session unique id.
   * @param config The session configuration.
   */
  private async startLocalSession(
    id: number,
    config: SessionParams,
  ): Promise<Session> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionConfig = loadConfig(undefined, config) as any
    const session = new Session({ ...sessionConfig, id })
    session.once('stop', () => {
      console.warn(`Session ${id} stopped, reloading...`)
      setTimeout(
        this.startLocalSession.bind(this),
        sessionConfig.spawnPeriod,
        id,
        config,
      )
    })
    this.stats.addSession(session)
    try {
      await session.start()
    } catch (err) {
      this.stats.removeSession(session.id)
      throw err
    }
    return session
  }

  /**
   * Stops a new {@link Session} instance.
   * @param {number} id The session unique id.
   */
  private async stopLocalSession(id: number): Promise<void> {
    const session = this.stats.sessions.get(id)
    if (!session) {
      log.warn(`stopLocalSession session ${id} not found`)
      return
    }
    session.removeAllListeners()
    this.stats.removeSession(id)
    await session.stop()
  }

  /**
   * Starts the {@link Server} instance.
   */
  async start(): Promise<void> {
    log.info('start')
    if (this.serverUseHttps) {
      const destDir = path.join(os.homedir(), '.webrtcperf/ssl')
      await runShellCommand(
        `mkdir -p ${destDir} && openssl req -newkey rsa:2048 -nodes -keyout ${destDir}/domain.key -x509 -days 365 -out ${destDir}/domain.crt -subj "/C=EU/ST=London/L=London/O=Global Security/OU=IT Department/CN=example.com"`,
      )
      this.server = _createServer(
        {
          key: fs.readFileSync(`${destDir}/domain.key`),
          cert: fs.readFileSync(`${destDir}/domain.crt`),
        },
        this.app,
      )
    } else {
      this.server = createServer(this.app)
    }
    this.server.listen(this.serverPort, () => {
      log.info(`HTTPS server listening on port ${this.serverPort}`)
    })
  }

  /**
   * Stops the {@link Server} instance.
   */
  stop(): void {
    if (this.server) {
      log.info('stop')
      this.server.close()
      this.server = null
    }
  }
}

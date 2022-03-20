import server from './server.js'

import { logger } from './util.js'
import config from './config.js'

server().listen(config.port)
  .on('listening', () => logger.info(`Server Running at ${config.port}`))

// Make the application non stopable
process.on('uncaughtException', 
  (error) => logger.error(`UnhandledRejection happened: ${error.stack || error }`))
process.on('unhandledRejection', 
  (error) => logger.error(`UnhandledRejection happened: ${error.stack || error }`))
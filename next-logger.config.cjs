const pino = require('pino')

module.exports = {
    logger: (defaultConfig) => pino({ ...defaultConfig, level: process.env.LOG_LEVEL ?? 'info' }),
}

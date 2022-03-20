import fs from 'fs'
import fsPromises from 'fs/promises'
import path, { join, extname } from 'path'
import { randomUUID } from 'crypto'
import { PassThrough, Writable } from 'stream'
import streamPromises from 'stream/promises'
import Throttle from 'throttle'
import child_process from 'child_process'
import { once } from 'events'

import { logger } from './util.js'
import config from './config.js'

const { dir : { publicDirectory, fxDirectory }, 
  constants: { 
    fallbackBitRate, 
    englishConversation, 
    bitRateDivisor,
    audioMediaType,
    songVolume,
    fxVolume
  } 
} = config

export class Service {
  constructor() {
    this.clientStreams = new Map()
    this.currentSong = englishConversation
    this.currentBitRate = 0
    this.throttleTransform = {}
    this.currentReadable = {}
  }

  createClientStream() {
    const id = randomUUID()
    const clientStream = new PassThrough()
    this.clientStreams.set(id, clientStream)

    return {
      id,
      clientStream
    }
  }

  removeClientStream(id) {
    this.clientStreams.delete(id)
  }

  _executeSoxCommand(args) {
    return child_process.spawn('sox', args)
  }

  async getBitRate(song) {
    try {
      const args = [
        '--i',
        '-B',
        song
      ]
      const { stderr, stdout, stdin } = this._executeSoxCommand(args)
      await Promise.all([once(stdout, 'readable'), once(stderr, 'readable')])
      
      const [success, error] = [stdout, stderr].map(stream => stream.read())

      if (error) return await Promise.reject(error)

      return success.toString().trim().replace(/k/, '000')
    } catch (error) {
      logger.error(`Error in bitRate: ${error}`)
      return fallbackBitRate
    }
  }

  broadCast() {
    return new Writable({ 
      write: ( chunk, enc, cb) => {
        for (const [key, stream] of this.clientStreams) {
          if (stream.writableEnded) {
            this.clientStreams.delete(key)
            continue
          }

          stream.write(chunk)
        }

        cb()
    }})
  }

  async startStreamming() {
    logger.info(`Starting with ${this.currentSong}`)
    const bitRate = this.currentBitRate = (await this.getBitRate(this.currentSong)) / bitRateDivisor
    const throttleTransform = this.throttleTransform = new Throttle(bitRate)
    const songReadable = this.currentReadable = this.createFileStream(this.currentSong)
    return streamPromises.pipeline(songReadable, throttleTransform, this.broadCast())
  }

  stopStreamming() {
    this.throttleTransform?.end?.()
  }

  createFileStream(filename) {
    return fs.createReadStream(filename)
  }

  async getFileInfo(file) {
    const fullFilePath = join(publicDirectory, file)
    // Check if file exists
    await fsPromises.access(fullFilePath)

    const fileType = extname(fullFilePath)

    return {
      type: fileType,
      name: fullFilePath
    }
  }

  async getFileStream(file) {
    const { name, type } = await this.getFileInfo(file)
    
    return {
      stream: this.createFileStream(name),
      type
    }
  }

  async readFxByName(fxName) {
    const songs = await fsPromises.readdir(fxDirectory)
    const chosenSong = songs.find(filename => filename.toLowerCase().includes(fxName))

    if (!chosenSong) return Promise.reject(`The song ${fxName} wasn't found!`)

    return path.join(fxDirectory, chosenSong)
  }

  appendFxStream(fx) {
    const throttleTransformable = new Throttle(this.currentBitRate)
    streamPromises.pipeline(throttleTransformable, this.broadCast())

    const unpipe = () => {
      const transformStream = this.mergeAudioStreams(fx, this.currentReadable)

      this.throttleTransform = throttleTransformable
      this.currentReadable = transformStream
      this.currentReadable.removeListener('unpipe', unpipe)

      streamPromises.pipeline(transformStream, throttleTransformable)
    }

    this.throttleTransform.on('unpipe', unpipe)
    this.throttleTransform.pause()
    this.currentReadable.unpipe(this.throttleTransform)
  }

  mergeAudioStreams(song, readable) {
    const transformStream = PassThrough()
    const args = [
      '-t', audioMediaType,
      '-v', songVolume,
      '-m', '-', // '-' is to receive the stream
      '-t', audioMediaType,
      '-v', fxVolume,
      song,
      '-t', audioMediaType,
      '-'
    ]

    const { stderr, stdout, stdin } = this._executeSoxCommand(args)

    // plug the conversation stream to the terminal entry
    streamPromises.pipeline(readable, stdin)
      // .catch(error => logger.error(`Error on sending stream to sox: ${error}`))
    streamPromises.pipeline(stdout, transformStream)
      // .catch(error => logger.error(`Error on receiving stream from sox: ${error}`))


    return transformStream
  }
}
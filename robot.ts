import {EventEmitter} from 'events';
let httpClient = require('scoped-http-client');
import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as express from 'express';
import {existsSync, readFileSync} from 'fs';
import * as fs from 'fs';
import * as https from 'https';
import {env, exit} from 'process';
import * as winston from 'winston';

import Adapter from './adapter';
import Brain from './brain';
import Config from './config';
import Envelope from './envelope';
import frontend from './frontend';
import {Listener, TextListener} from './listener';
import {Message, TextMessage} from './message';
import Response from './response';
import User from './user';

let HUBOT_DOCUMENTATION_SECTIONS = [
  'description',
  'dependencies',
  'configuration',
  'commands',
  'notes',
  'author',
  'authors',
  'examples',
  'tags',
  'urls',
];

export interface ResponseCallback {
  (response: Response): void;
}

export default class Robot extends EventEmitter {
  name: string;
  config: Config;
  pluginListeners: Array<Listener> = [];
  commands: any;
  errorHandlers: any;
  TextMessage: TextMessage;  // tslint:disable-line
  router: any;
  logger: any;
  brain: Brain;
  frontend: any;
  adapters: any;
  plugins: any;
  server: any;

  constructor(config: Config) {
    super();
    this.config = config;

    if (!config.name) {
      winston.error('`name` is importd to start robot');
      throw new Error('`name` is importd to start robot');
    } else {
      this.name = config.name;
    }

    if (!config.adapters) {
      throw new Error('A list of `adapters` is required to start robot.');
    }

    // Default variables
    this.pluginListeners = [];
    this.commands = [];
    this.errorHandlers = [];
    this.router = undefined;
    this.logger = new (winston.Logger)({
      transports: [
        new (winston.transports.Console)({level: 'debug'}),
        new (winston.transports.File)({filename: 'bot.log', level: 'debug'})
      ]
    });
    this.brain = new Brain(this);
    this.setupExpress();

    this.frontend = new frontend(this);

    this.logger.debug('[Robot] Starting Robot');

    this.adapters = {};
    this.plugins = {};
    for (let adapter of config.adapters) {
      this.logger.info('[Robot] loading adapter:', adapter);
      let adapterModule = require(adapter);
      // Use default here to get the default exported class
      let adapterClass = new adapterModule.default(this);
      this.adapters[adapterClass.adapterName] = adapterClass;
      adapterClass.run();
    }
    this.emit('adapterInitialized');

    for (let plugin of config.plugins) {
      this.logger.info('[Robot] loading plugin:', plugin);
      let pluginModule = require(plugin);
      // Use default here to get the default exported function
      pluginModule.default(this);
      let filename = require.resolve(plugin);
      this.parseHelp(filename);
    }
    this.logger.debug('[Robot] Finished loading plugins');
    this.emit('pluginsInitialized');

    // TODO: can't register for an on('pluginsInitialized'..) in adapters for some reason.
    if (this.adapters.AlexaAdapter) {
      this.logger.debug('initing alexa plugins');
      this.adapters.AlexaAdapter.postPluginInit();
    }
    // this.frontend.setup();
    this.listen();
  }

  hear(regex: RegExp, options: any, callback: ResponseCallback) {
    this.logger.info('creating hear listener for regex', regex);
    let listener = new TextListener(this, regex, options, callback);
    this.pluginListeners.push(listener);
  }

  respond(regex: RegExp, options: any, callback: ResponseCallback) {
    this.logger.info('creating respond listener for regex', regex);
    let listener = new TextListener(this, this.respondPattern(regex), options, callback);
    this.pluginListeners.push(listener);
  }

  respondPattern(regex: RegExp) {
    let re = regex.toString().split('/');
    re.shift();
    let modifiers = re.pop();

    // Default to case insensitive if not otherwise declared, or bot name gets messed up
    // NOTE: change from upstream
    if (!modifiers) {
      modifiers = 'i';
    }

    if (re[0] && re[0][0] === '^') {
      this.logger.warn('Anchors don\'t work well with respond, perhaps you ' +
          'want to use "hear"');
      this.logger.warn(`The regex in question was ${regex.toString()}`);
    }

    let name = this.name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    let pattern = re.join('/');

    return new RegExp('^\\s*[@]*' + name.toLowerCase() + '[:,]?\\s*(?:' + pattern + ')', modifiers);
  }

  parseHelp(path) {
    let body, cleanedLine, currentSection, i, j, len, len1, line, nextSection, ref, ref1,
      scriptDocumentation, scriptName,
      indexOf = [].indexOf || function(item) { for (let i = 0, l = this.length; i < l; i++) {
        if (i in this && this[i] === item) return i; } return -1;
      };

    this.logger.debug('[Robot] Parsing help for ' + path);

    scriptDocumentation = {};

    body = readFileSync(path, 'utf-8');

    currentSection = null;

    ref = body.split('\n');
    for (i = 0, len = ref.length; i < len; i++) {
      line = ref[i];
      if (!(line[0] === '#' || line.substr(0, 2) === '//')) {
        break;
      }
      cleanedLine = line.replace(/^(#|\/\/)\s?/, '').trim();
      if (cleanedLine.length === 0) {
        continue;
      }
      if (cleanedLine.toLowerCase() === 'none') {
        continue;
      }
      nextSection = cleanedLine.toLowerCase().replace(':', '');
      if (indexOf.call(HUBOT_DOCUMENTATION_SECTIONS, nextSection) >= 0) {
        currentSection = nextSection;
        scriptDocumentation[currentSection] = [];
      } else {
        if (currentSection) {
          scriptDocumentation[currentSection].push(cleanedLine.trim());
          if (currentSection === 'commands') {
            this.commands.push(cleanedLine.trim());
          }
        }
      }
    }

    if (currentSection === null) {
      this.logger.info('[Robot] ' + path + ' is using deprecated documentation syntax');
      scriptDocumentation.commands = [];
      ref1 = body.split('\n');
      for (j = 0, len1 = ref1.length; j < len1; j++) {
        line = ref1[j];
        if (!(line[0] === '#' || line.substr(0, 2) === '//')) {
          break;
        }
        if (!line.match('-')) {
          continue;
        }
        cleanedLine = line.slice(2, +line.length + 1 || 9e9).replace(/^hubot/i, this.name).trim();
        scriptDocumentation.commands.push(cleanedLine);
        this.commands.push(cleanedLine);
      }
    }
  }

  reply(envelope: Envelope, user: User, messages) {
    // robot.logger.debug('ROBOT REPLY', envelope, user, messages)
    this.logger.debug(`Attempting to reply to ${user} in #${envelope.room}, message: ${messages}`);

    if (!Array.isArray(messages)) {
      messages = [messages];
    }

    this.adapters[envelope.adapterName].reply(envelope, user, messages);
  }

  send(envelope: Envelope, messages) {
    this.logger.debug(`Sending in ${envelope.room}: ${messages}`);

    if (!Array.isArray(messages)) {
      messages = [messages];
    }
    let adapter = this.adapters[envelope.adapterName];
    if (!adapter) {
      throw new Error(`Invalid adapter name: ${envelope.adapterName}`);
    }
    adapter.send(envelope, messages);
  }

  emote(envelope: Envelope, emotes) {
    this.logger.warn('Unsupported action: emote', envelope.room, emotes);
  }

  enter(options, callback) {
    this.logger.warn('Unsupported action: enter', options);
  }

  leave(options, callback) {
    this.logger.warn('Unsupported action: leave', options);
  }

  topic(options, callback) {
    this.logger.warn('Unsupported action: topic', options);
  }

  error(callback) {
    this.errorHandlers.push(callback);
  }

  // Get a key from the environment, or throw an error if it's not defined
  envKey(key) {
    let value = process.env[key];
    if (!value) {
      throw new Error(`${key} environment variable not defined`);
    }
    return value;
  }

  catchAll(options, callback) {
    if (!callback) {
      callback = options;
      options = {};
    }

    this.logger.warn('Unsupported action: catchAll', options);
  }

  http(url: string, options: any = {}) {
    return httpClient.create(url, options).header('User-Agent', `${this.name}/1.0`);
  }

  receive(message: Message, adapter: Adapter, callback) {
    this.logger.info('received message');

    for (let listener of this.pluginListeners) {
      this.logger.debug(listener.matcher);
      listener.call(message, adapter, callback);
    }
  }

  setupExpress() {
    let app = express();

    app.use(cors());

    app.use((req, res, next) => {
      res.setHeader('X-Powered-By', `hubot/${this.name}/1.0`);
      next();
    });

    app.use(bodyParser.urlencoded({extended: false}));
    app.use(bodyParser.json());
    app.use('/static', express.static('static'));
    app.use('/bower_components', express.static('bower_components'));
    this.router = app;
  }

  listen() {
    let port = process.env.EXPRESS_BIND_PORT || 8080;
    let address = process.env.EXPRESS_BIND_ADDRESS || '0.0.0.0';
    this.logger.debug('[Robot] All routes:');
//    this.logger.debug(this.router.stack);
    this.router._router.stack.forEach((r) => {
      if (r.route && r.route.path) {
        this.logger.debug('[Robot] ' + r.route.path);
      }
    });

    try {
      this.router.listen(port, address);
//      this.server = https.createServer({
//        key: fs.readFileSync('./certs/server/privkey.pem'),
//        cert: fs.readFileSync('./certs/server/fullchain.pem'),
//        rejectUnauthorized: false
//    }, this.router).listen(port, () => {
      this.logger.info(`[Robot] Listening at ${address}:${port}`);
//    });
    } catch (err) {
      this.logger.error(`[Robot] Error trying to start HTTP server: ${err}\n${err.stack}`);
      process.exit(1);
    }
  }
  // filesystemPath: Relative path to the file
  // url: the URL to expose the file at. Will be served as `/static/${url}`
  addStaticFile(filesystemPath, url) {
    this.logger.debug(`[Robot] Adding static file: static/${url}:${filesystemPath}`);
    if (!existsSync(filesystemPath)) {
      throw new Error(`[Robot] Script does not exist: ${filesystemPath}`);
    }
    this.router.use('/static/' + url, (req, res) => {
      this.logger.debug(`[Robot] Serving ${req.path}: ${filesystemPath}`);
      res.sendFile(filesystemPath);
    });
  }
}
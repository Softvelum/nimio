import { VUMeterService } from './vumeter/service';
import { LoggersFactory } from './shared/logger';
import { PlaybackContext } from './playback/context';
import { PlaybackProgressService } from './playback/progress-service';
import { AudioContextProvider } from './audio/context-provider';
import { throttler } from './shared/helpers';

const VOD_STATE = {
  NULL: 0,
  INIT: 1,
  SYNC: 2,
  PLAY: 3,
};

export class NimioVod {

  constructor (instanceName, config) {
    this._instName = instanceName;
    this._logger = LoggersFactory.create(this._instName, 'Nimio VOD');
    this._context = PlaybackContext.getInstance(this._instName);

    this._state = VOD_STATE.NULL;
    this._config = config;
    if (!this._config) return;

    // TODO: populate some settings if needed. Check default worker path.
    this._loadSourcePromise = this._addScriptTag(this._config.hlsjs.source);
    this._loadSourcePromise.then((script) => {
      this._pHandler = new Hls({
        // autoStartLoad: false,
        // workerPath: this._workerPath,
        // debug: true,
      });
      this._playerScript = script;
      this._state = VOD_STATE.INIT;
      this._playbackStarted = false;
      this._playbackErrCnt = 0;

      this._progressSvc = PlaybackProgressService.getInstance(this._instName);
      this._vuMeterSvc = VUMeterService.getInstance(this._instName);
      this._audCtxProvider = AudioContextProvider.getInstance(this._instName);
      // this._mediaControlSvc = MediaControlService.getInstance(this._instName);
      // this._segmentTracker = PlaybackSegmentTracker.getInstance(this._instName);

      if (this._config.timecodes) {
        // this._spsHolder = SPSHolder.getInstance(this._instName);
        // this._nalProcessor = NalProcessor.getInstance(this._instName);
        // this._seiProcessor = SeiProcessor.getInstance(this._instName);
      }

      this._onProgress = throttler(this, function () {
        if (!this._ui) return;

        this._progressSvc.updateVodProgress(
          this._ui.mediaElement.currentTime,
          this._ui.mediaElement.duration,
        );
      }, 100);
    }).catch((script) => {
      this._logger.error('Can not load HLS.js library from given source', script);
    });
  }

  destroy () {
    if (this._state === VOD_STATE.NULL) return;

    if (this._pHandler) {
      if (this._url) {
        this._pHandler.stopLoad();
        this._pHandler.detachMedia();
        this._pHandler.off(Hls.Events.MANIFEST_PARSED, this._onManifestParsed, this);
        this._pHandler.off(Hls.Events.LEVEL_LOADED, this._onLevelLoaded, this);
        this._pHandler.off(Hls.Events.MEDIA_DETACHED, this._onMediaDetached, this);
        this._pHandler.off(Hls.Events.MEDIA_ATTACHED, this._onMediaAttached, this);
        this._pHandler.off(Hls.Events.BUFFER_CODECS, this._onBufferCodecs, this);
        this._pHandler.off(Hls.Events.LEVEL_SWITCHED, this._onLevelSwitched, this);
        this._pHandler.off(Hls.Events.ERROR, this._onError, this);

        this._pHandler.off(Hls.Events.FRAG_PARSING_INIT_SEGMENT, this._onFragParsingInitSegment, this);
        this._pHandler.off(Hls.Events.BUFFER_APPENDING, this._onBufferAppending, this);

        // this._pHandler.off(Hls.Events.LEVEL_SWITCHING, this._onLevelSwitching, this);
        // this._pHandler.off(Hls.Events.FRAG_PARSING_USERDATA, this._onFragParsingUserData, this);
        // this._pHandler.off(Hls.Events.FRAG_PARSING_METADATA, this._onFragParsingMetaData, this);
        // this._pHandler.off(Hls.Events.FRAG_PARSED, this._onFragParsed, this);
        // this._pHandler.off(Hls.Events.FRAG_LOADING, this._onFragLoading, this);
        // this._pHandler.off(Hls.Events.FRAG_LOADED, this._onFragLoaded, this);
        // this._pHandler.off(Hls.Events.FRAG_BUFFERED, this._onFragBuffered, this);

        this._url = undefined;
        this._sessionParam = undefined;
        this._detachUI();
      }
      this._pHandler.destroy();
      this._pHandler = undefined;

      if (this._state >= VOD_STATE.SYNC ) {
        this._vuMeterSvc.stop();
        this._mediaControlSvc.clear();
        this._vodMedia.clear();
        this._vodMedia = undefined;
        if (this._config.timecodes) {
          this._nalProcessor.reset();
          this._nalProcessor = undefined;
          this._seiProcessor = undefined;
          this._picTimingProcessor = undefined;
          this._spsHolder = undefined;
        }
      }

      this._state = VOD_STATE.NULL;
      this._playbackStarted = false;
      this._switchInProgress = false;
      this._playbackErrCnt = 0;
      this._config = undefined;
      this._setMgr = undefined;

      if (this._playerScript) {
        document.head.removeChild(this._playerScript);
        this._playerScript = undefined;
      }
      this._loadSourcePromise = undefined;
    }
  }

  play () {
    if (this._state !== VOD_STATE.PLAY || !this._ui) return;

    let played = this._ui.triggerPlay();
    if (!played) {
      this._ui.triggerPause(true);
      return;
    }

    this._context.setState(true, false);
  }

  pause () {
    if (this._state !== VOD_STATE.PLAY || !this._ui) return;

    this._ui.triggerPause();
  }

  stop (callback) {
    if (this._state < VOD_STATE.SYNC) return;

    this._pHandler.stopLoad();
    if (this._ui) {
      this._ui.triggerPause( true );
      this._setDetachedState(callback);
      return;
    }

    if (callback) callback();
  }

  startAbr () {
    if (this._state !== VOD_STATE.PLAY || !this._ui) return;

    this._startAbr();
  }

  stopAbr () {
    if (this._state !== VOD_STATE.PLAY || !this._ui) return;

    this._context.setAutoAbr(false);
    let curLvl = this._setCurrentRendition(true);
    this._pHandler.autoLevelCapping = 0;
    this._pHandler.currentLevel = curLvl.idx;
    this._pHandler.nextLevel = curLvl.idx;
  }

  isAbr () {
    return this._context.getAutoAbr();
  }

  isRunning () {
    return this._state >= VOD_STATE.SYNC;
  }

  isPlaying () {
    return this._state === VOD_STATE.PLAY;
  }

  isLoaded () {
    return this._state !== VOD_STATE.NULL;
  }

  getHandler () {
    return this._pHandler;
  }

  getRenditions () {
    let renditions = [];
    let ords = this._context.orderedLevels();
    let lvls = this._context.levels();
    for( let i = 0; i < ords.length; i++ ) {
      renditions.push( lvls[ ords[i] ].rend );
    }

    return renditions;
  }

  getCurrentRendition () {
    let curLvl = this._context.getCurrentLevel();
    if (curLvl) return curLvl.rend;
  }

  changeRendition (rendition) {
    return this.onChangeRendition(rendition, 0);
  }

  _formatLevel (lvl) {
    let stream;
    if (lvl) {
      stream = {
        name:      lvl.name,
        bandwidth: lvl.data.bitrate,
      };
      if (lvl.data.width > 0) stream.width  = lvl.data.width;
      if (lvl.data.height > 0) stream.height = lvl.data.height;
    }

    return stream;
  }

  getStreams () {
    let streams = [];
    let ords = this._context.orderedLevels();
    let lvls = this._context.levels();
    for( let i = 0; i < ords.length; i++ ) {
      streams.push( this._formatLevel(lvls[ ords[i] ]) );
    }

    return streams;
  }

  getCurrentStream () {
    let curLvl = this._context.getCurrentLevel();
    if (curLvl) return this._formatLevel(curLvl);
  }

  changeStream (streamName) {
    let lvl = this._context.getLevelByName(streamName);
    if (lvl) {
      return this.onChangeRendition(lvl.rend, lvl.rIdx);
    }

    return false;
  }

  getCurrentStreamBandwidth () {
    return 0;
  }

  // TODO: handle CC related methods
  getCaptionTracks () {
    return [];
  }

  getCurrentCaptionTrack () {
    return {};
  }

  setCaptionTrack (name) {
    return false;
  }

  initialize (mediaElement) {
    return this._loadSourcePromise.then(() => {
      if (
        this._state === VOD_STATE.NULL || this._state === VOD_STATE.PLAY ||
        this._url === this._config.url
      ) return;

      if (this._state === VOD_STATE.INIT) {
        this._pHandler.on(Hls.Events.MANIFEST_PARSED, this._onManifestParsed);
        this._pHandler.on(Hls.Events.LEVEL_LOADED, this._onLevelLoaded);
        this._pHandler.on(Hls.Events.MEDIA_DETACHED, this._onMediaDetached);
        this._pHandler.on(Hls.Events.MEDIA_ATTACHED, this._onMediaAttached);
        this._pHandler.on(Hls.Events.BUFFER_CODECS, this._onBufferCodecs);
        this._pHandler.on(Hls.Events.LEVEL_SWITCHED, this._onLevelSwitched);
        this._pHandler.on(Hls.Events.ERROR, this._onError);

        this._pHandler.on(Hls.Events.FRAG_PARSING_INIT_SEGMENT, this._onFragParsingInitSegment);
        this._pHandler.on(Hls.Events.BUFFER_APPENDING, this._onBufferAppending);

        // this._pHandler.on(Hls.Events.LEVEL_SWITCHING, this._onLevelSwitching);
        // this._pHandler.on(Hls.Events.FRAG_PARSING_USERDATA, this._onFragParsingUserData);
        // this._pHandler.on(Hls.Events.FRAG_PARSING_METADATA, this._onFragParsingMetaData);
        // this._pHandler.on(Hls.Events.FRAG_PARSED, this._onFragParsed);
        // this._pHandler.on(Hls.Events.FRAG_LOADING, this._onFragLoading);
        // this._pHandler.on(Hls.Events.FRAG_LOADED, this._onFragLoaded);
        // this._pHandler.on(Hls.Events.FRAG_BUFFERED, this._onFragBuffered);

        this._vodMedia = new VodMedia(this._instName);
        if (mediaElement) {
          this._mediaControlSvc.init(mediaElement);
        }
        this._state = VOD_STATE.SYNC;
      }

      this._url = this._config.url;
      this._pHandler.loadSource(this._fullUrl());
    }).catch(() => {
      this._logger.error('Can not initialize VOD player because HLS.js library was not loaded');
    });
  }

  attach (ui, position, callback) {
    if (this._state < VOD_STATE.SYNC) return false;

    if (callback && !this._mediaAttachedCallback) {
      this._mediaAttachedCallback = callback;
    }

    this._ui = ui;
    this._vodMedia.init(ui.mediaElement);
    this._mediaControlSvc.useApi('vod', this._vodMedia);
    this._setMediaControlCallbacks();
    this._ui.clearMediaElement();
    this._state = VOD_STATE.PLAY;

    let currentLevel = this._context.getCurrentLevel();
    if (currentLevel) {
      this._pHandler.stopLoad();
      this._reloadLevels = true;
    }

    this._logger.debug('Attach VOD player', this._fullUrl());
    this._pHandler.loadSource(this._fullUrl());
    this._pHandler.pauseBuffering();
    this._pHandler.attachMedia(this._ui.mediaElement);
    this._ui.mediaElement.addEventListener('progress', this._onProgress);
    this._ui.mediaElement.addEventListener('timeupdate', this._onProgress);

    if (position !== undefined) {
      this._logger.debug('after attach should go to ' + position);
      this.goto(position);
      return true;
    }

    return false;
  }

  detach (callback) {
    if (this._state !== VOD_STATE.PLAY) return false;

    this._setDetachedState(callback);

    if (this._nalProcessor) {
      this._nalProcessor.reset();
    }

    if (this._context.hasVod()) {
      this._loadCurrentLevel();
    }

    return true;
  }

  _setDetachedState (callback) {
    if (callback && !this._mediaDetachedCallback) {
      this._mediaDetachedCallback = callback;
    }

    this._mediaControlSvc.keepPlaybackState(this._context);
    this._mediaControlSvc.clear({keepPlayback: true});

    this._pHandler.detachMedia();
    this._vuMeterSvc.stop();
    this._state = VOD_STATE.SYNC;
    this._playbackStarted = false;
    this._switchInProgress = false;
    this._playbackErrCnt = 0;

    this._detachUI();
  }

  _detachUI () {
    if (!this._ui) return;

    this._ui.mediaElement.removeEventListener('progress', this._onProgress);
    this._ui.mediaElement.removeEventListener('timeupdate', this._onProgress);
    this._ui = undefined;
  }

  goto (position) {
    if (this._state !== VOD_STATE.PLAY) return false;

    this._logger.debug('goto ' + position);
    this._mediaControlSvc.resumeTo(position);
    if (this._nalProcessor) {
      this._nalProcessor.reset();
    }
    return true;
  }

  switchToCurrentRendition () {
    if (this._state !== VOD_STATE.SYNC) return;

    if (this._context.hasVod()) {
      this._pHandler.stopLoad();
      this._loadCurrentLevel();
    }
  }

  onUserAction () {
    return this._state === VOD_STATE.PLAY;
  }

  setCallbacks (cbs) {
    if( cbs.onPlay ) {
      this._sdk.onPlay = cbs.onPlay;
    }
    if( cbs.onPause ) {
      this._sdk.onPause = cbs.onPause;
    }
    if (cbs.onTimecodeArrived) {
      this._sdk.onTimecodeArrived = cbs.onTimecodeArrived;
      if (this._picTimingProcessor) {
        this._picTimingProcessor.setCallback(this._onTimecodeArrived);
      }
    }
  }

  setInterCallbacks (cbs) {
    this._onRenditionSwitchCallback = cbs.onRenditionSwitch;
    this._onRenditionSwitchedCallback = cbs.onRenditionSwitched;
    this._onPlaybackErrorCallback = cbs.onError;
  }

  hasPlaybackErrors () {
    return this._playbackErrCnt > 0;
  }

  _setMediaControlCallbacks () {
    this._mediaControlSvc.callbacks = {
      onPlayStarted: this._onPlayStarted,
      onPlayFinished: this._onPlayFinished,
    }
  }

  _startAbr () {
    this._context.setAutoAbr(true);
    this._setCurrentRendition(true);
    this._pHandler.autoLevelCapping = -1;
    this._pHandler.currentLevel = -1;
    this._pHandler.nextLevel = -1;
  }

  onChangeRendition (quality, idx) {
    if (this._state === VOD_STATE.PLAY && !this._switchInProgress) {
      if ('Auto' === quality) {
        if (this._onRenditionSwitchCallback) {
          this._onRenditionSwitchCallback('Auto');
        }
        this._startAbr();
        return true;
      }

      let levelIdx = this._context.getRenditionLevelIdx(quality, idx);
      if (levelIdx === undefined) return false;

      if (this._onRenditionSwitchCallback) {
        let lvl = this._context.levels()[levelIdx];
        this._onRenditionSwitchCallback(quality, lvl.name);
      }

      this._switchInProgress = true;
      this._context.setCurrentLevelIdx(levelIdx);
      // TODO: Decide which approach to use for rendition switch
      // this._pHandler.currentLevel = levelIdx; // immediate rendition change
      this._pHandler.nextLevel = levelIdx; // rendition change will occur on the next segment
      this._pHandler.autoLevelCapping = 0;
      this._context.setAutoAbr(false);

      return true;
    }

    this._logger.warn('Rendition change isn\'t available at the moment');
    return false;
  }

  onPlay (isGesture) {
    if (this._state !== VOD_STATE.PLAY) return;

    this._mediaControlSvc.handlePlay(isGesture, true);
  }

  onPause () {
    if (this._state !== VOD_STATE.PLAY) return;

    this._mediaControlSvc.handlePause(true);
  }

  onPauseEvent () {
    this._mediaControlSvc.handlePauseEvent();
  }

  onPlayEvent () {
    this._mediaControlSvc.handlePlayEvent();
  }

  onResize () {

  }

  onEnterPip () {
    this._mediaControlSvc.handleEnterPip();
  }

  onLeavePip () {
    this._mediaControlSvc.handleLeavePip(true);
  }

  _addScriptTag (url) {
    return new Promise(function (resolve, reject) {
      if (!url) {
        return resolve();
      }

      let script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = url;

      script.onload = () => resolve(script);
      script.onerror = () => reject(script);

      document.head.appendChild(script);
    });
  }

  _updatePlaylistDuration (details) {
    this._progressSvc.updateVodPlaylistDuration(details.totalduration);
    // this._logger.warn('TOTAL DURATION', details.totalduration); // details.edge,
  }

  _fullUrl () {
    if (this._url) {
      return this._url + (this._sessionParam ? `?${this._sessionParam}` : '');
    }
  }

  _loadCurrentLevel () {
    let currentLevel = this._context.getCurrentLevel();
    if (currentLevel) {
      this._pHandler.loadSource(currentLevel.data.url[0]);
    } else {
      this._logger.error('Unable to load current level');
    }
  }

  _onManifestParsed = (event, data) => {
    if (!data.levels || data.levels.length === 0) return;

    let currentLevel = this._context.getCurrentLevel();

    if (!currentLevel || (this._reloadLevels && !data.levels[0].details)) {
      this._context.setLevels(data.levels, this._url);
      if (!this._context.hasLive()) {
        let initialLvl;
        if (this._config.initial_resolution) {
          for (let i = 0; i < data.levels.length; i++) {
            if (
              data.levels[i].height && 
              (data.levels[i].height + 'p') === this._config.initial_resolution
            ) {
              initialLvl = i;
              break;
            }
          }
        }
        if (undefined === initialLvl) {
          initialLvl = this._context.getMinimumLevelIdx();
        }
        this._context.setCurrentLevelIdx(initialLvl);
      }

      currentLevel = this._context.getCurrentLevel();
      this._sessionParam = currentLevel.session;

      if (this._state === VOD_STATE.PLAY) {
        this._ui.setupRenditions( this._prepareQualities() );
        this._pHandler.currentLevel = currentLevel.idx;
        if (this._context.getAutoAbr()) {
          this._pHandler.autoLevelCapping = -1;
          this._pHandler.nextLevel = -1;
        } else {
          this._pHandler.autoLevelCapping = 0;
          this._pHandler.nextLevel = currentLevel.idx;
        }
        this._reloadLevels = false;
      } else {
        this._loadCurrentLevel();
      }
      return;
    }

    // this._logger.warn('Manifest with levels', data.levels.length);

    this._context.updateCurrentLevel(data.levels[0]);
    if (currentLevel && currentLevel.data.details) {
      this._updatePlaylistDuration(currentLevel.data.details);
      if (this._config.thumbnails) {
        this._segmentTracker.setup(data.details.fragments);
      }
    }
  };

  _onLevelLoaded = (event, data) => {
    // this._logger.warn('_onLevelLoaded details', data.details);
    this._updatePlaylistDuration(data.details);
    if (this._config.thumbnails) {
      this._segmentTracker.setup(data.details.fragments);
    }
    this._playbackErrCnt = 0;

    if (this._state !== VOD_STATE.PLAY || this._playbackStarted) return;

    let pbState = this._context.getState();
    let isInitial = pbState.initial;
    if ((this._config.autoplay && isInitial) || pbState.playing) {
      this._pHandler.resumeBuffering();

      let playPromise = this._mediaControlSvc.startPlayback();

      if (playPromise) {
        playPromise.then(() => {
          this._ui.onPlaybackStarted();
          this._playbackStarted = true;
          this._context.setState(true, false);
          this._context.setStateInitial(false);
        });
      } else if (isInitial) {
        this._ui.canPlay = true;
      }
    }
  };

  // TODO: remove if it's not needed in the next release after introducing VOD
  // _onLevelSwitching = (event, data) => {
  //   // this._switchInProgress = true;
  //   this._logger.debug('Level switching started', data.level);
  // };

  _onLevelSwitched = (event, data) => {
    let lvl = this._context.levels()[data.level];
    if (!lvl) {
      this._logger.error('Switch level error, level not found', data.level, this._context.levels());
      return;
    }

    this._logger.debug('Rendition switched to', lvl.rend, lvl.name);
    if (this._onRenditionSwitchedCallback) {
      this._onRenditionSwitchedCallback(lvl.rend, lvl.name);
    }
    this._context.setCurrentLevelIdx(lvl.idx);
    this._setCurrentRendition();
    this._switchInProgress = false;
    this._ui.adjustAspectRatio();
  };

  _setCurrentRendition (skipInitResolution) {
    let curLvl = this._context.getCurrentLevel();
    if( undefined !== curLvl ) {
      if (!skipInitResolution) {
        this._config.initial_resolution = curLvl.rend;
        let stream = this._context.getStreamByName(curLvl.name);
        if (stream && stream.stream_info) {
          this._setMgr.updateLiveInitialResolution(stream.stream_info.height);
        }
      }

      this._ui.setCurrentRendition(
        curLvl.rend,
        curLvl.rIdx,
        this._context.getAutoAbr(),
      );
    }

    return curLvl;
  }

  _onMediaAttached = () => {
    if (this._mediaAttachedCallback) {
      this._mediaAttachedCallback();
      this._mediaAttachedCallback = undefined;
    }
  };

  _onMediaDetached = () => {
    if (this._mediaDetachedCallback) {
      this._mediaDetachedCallback();
      this._mediaDetachedCallback = undefined;
    }
  };

  _onBufferCodecs = (event, data) => {
    if (data && data.audio) {

      let channels = 2;
      if (data.audio.metadata && data.audio.metadata.channelCount > 0) {
        channels = data.audio.metadata.channelCount;
      }

      let audioConfig = AudioHelper.getAudioConfigFromInitSegment(
        data.audio.codec.toLowerCase(),
        data.audio.initSegment,
      );
      if (audioConfig.audioChannels !== channels) {
        this._logger.error(`Error parsing init segment for ${data.audio.codec}. Hls returns ${channels} channels, while parsing returns channels = ${audioConfig.audioChannels} and samplerate = ${audioConfig.samplingRate}`);
      }

      this._audCtxProvider.setChannelCount(channels);
      this._vuMeterSvc.setAudioInfo({
        samplingRate: audioConfig.samplingRate,
        channels: channels,
      });

      if (!this._vuMeterSvc.isStarted()) {
        this._vuMeterSvc.start();
      }
    }
  };

  _onError = (event, data) => {
    if (data.fatal) {
      switch (data.type) {
        case Hls.ErrorTypes.MEDIA_ERROR:
          if (this._playbackErrCnt === 0) {
            this._playbackErrCnt++;
            this._pHandler.recoverMediaError();
          } else {
            this._onPlaybackErrorCallback(data.type);
          }
          break;
        case Hls.ErrorTypes.NETWORK_ERROR:
        default:
          this._playbackErrCnt++;
          this._onPlaybackErrorCallback(data.type);
          break;
      }
    }
  }

  _onPlayStarted = () => {
    if (this._ui) {
      this._ui.onPlaybackStarted();
    }
  };

  _onPlayFinished = () => {
    if (this._ui) {
      this._ui.triggerPause(true);
    }
  };

  _onTimecodeArrived = (frameTs, clockTs, stringTs) => {
    this._runSdkCallback('onTimecodeArrived', frameTs, clockTs, stringTs, {vod: true});
  };

  _onFragParsingInitSegment = (name, data) => {
    // console.log('Frag parsing init segment', name, data);
    if (this._config.timecodes) {
      let prevCodec = this._spsHolder.getCodec();
      if (!data.tracks || !data.tracks.video || !data.tracks.video.initSegment) {
        return;
      }

      let cd = VideoHelper.getCodecDataFromInitSegment(data.tracks.video.initSegment);
      if (!cd.codec || !cd.data) return;

      this._timescale = cd.timescale;
      this._trackId = cd.trackId;

      this._spsHolder.setCodec(cd.codec);
      this._spsHolder.parseDecoderConfig(cd.data);

      if (prevCodec) this._nalProcessor.reset();
      if (prevCodec === this._spsHolder.getCodec()) {
        this._initPicTimingProcessor();
        // codec is the same, there's no point in resetting related nal handlers
        return;
      }

      this._nalProcessor.setCodec(cd.codec);
      this._seiProcessor.init();
      this._seiProcessor.setCodec(cd.codec);
      this._nalProcessor.addNalHandler(this._seiProcessor, 'SEI');
      this._initPicTimingProcessor();
    }
  }

  _initPicTimingProcessor () {
    this._picTimingProcessor = this._seiProcessor.getPicTimingHandler();
    if (!this._picTimingProcessor) {
      this._picTimingProcessor = this._seiProcessor.addPicTimingHandler();
    }

    if (this._sdk.onTimecodeArrived) {
      this._picTimingProcessor.setCallback(this._onTimecodeArrived);
    }
  }

  _onBufferAppending = (name, buffer) => {
    if (this._config.timecodes) {
      if (buffer.type !== 'video') return;

      let frames = VideoHelper.getFramesFromDataSegment(
        buffer.data,
        this._timescale,
        this._trackId
      );
      for (let i = 0; i < frames.length; i++) {
        this._nalProcessor.handleFrame(frames[i][0], frames[i][1]);
      }
    }
  }

  // _onFragParsingUserData = (name, data) => {
  //   console.log('Frag parsing user data', name, data);
  // };

  // _onFragParsingMetaData = (name, data) => {
  //   console.log('Frag parsing metadata', name, data);
  // }

  // _onFragParsed = (name, data) => {
  //   console.log('Frag parsed', data.payload.byteLength);
  // }

  // _onFragBuffered = (name, data) => {
  //   console.log('Frag buffered', data, this._pHandler);
  // }

  // _onFragLoaded = (name, data) => {
  //   console.log('Frag loaded', data, this._pHandler);
  // }

  _runSdkCallback( callback, ...params ) {
    if(this._sdk[callback] ) {
      this._sdk[callback]( ...params );
    }
  }

  _prepareQualities () {
    let ords = this._context.orderedLevels();
    let levels = this._context.levels();

    let idx = 0, result = [];
    let fmt = this._config.adaptive_bitrate.format;
    for (let i = 0; i < ords.length; i++) {
      let params = {rendition: levels[ords[i]].data.height + 'p'};
      if (fmt) {
        params.width = levels[ords[i]].data.width;
        params.height = levels[ords[i]].data.height;
        params.codec = VideoHelper.getVideoCodecGen(levels[ords[i]].data.videoCodec) || '';
      }
      result[i] = {
        name: params.rendition,
        disp: fmt ? Utils.fillTemplateStr(fmt, params) : params.rendition,
        idx: idx,
      };
      if (i > 0) {
        idx = result[i].name === result[i - 1].name ? idx + 1 : 0;
        result[i].idx = idx;
      }
    }

    return result;
  }

}
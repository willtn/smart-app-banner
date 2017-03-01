'use strict';

var extend = require('xtend/mutable');
var q = require('component-query');
var doc = require('get-doc');
var cookie = require('cookie-cutter');
var ua = require('ua-parser-js');

// IE < 11 doesn't support navigator language property.
/* global navigator */
var userLangAttribute = navigator.language || navigator.userLanguage || navigator.browserLanguage;
var userLang = userLangAttribute.slice(-2) || 'us';
var root = doc && doc.documentElement;

// platform dependent functionality
var mixins = {
  ios: {
    appMeta: 'apple-itunes-app',
    appOption: 'itunesAppId',
    iconRels: ['apple-touch-icon-precomposed', 'apple-touch-icon'],
    getStoreLink: function () {
      return 'https://itunes.apple.com/' + this.options.appStoreLanguage + '/app/id' + this.appId;
    }
  },
  android: {
    appMeta: 'google-play-app',
    appOption: 'playAppId',
    iconRels: ['android-touch-icon', 'apple-touch-icon-precomposed', 'apple-touch-icon'],
    getStoreLink: function () {
      return 'http://play.google.com/store/apps/details?id=' + this.appId;
    }
  },
  windows: {
    appMeta: 'msApplication-ID',
    appOption: 'msAppId',
    iconRels: ['windows-touch-icon', 'apple-touch-icon-precomposed', 'apple-touch-icon'],
    getStoreLink: function () {
      return 'http://www.windowsphone.com/s?appid=' + this.appId;
    }
  }
};

var SmartBanner = function (options) {
  var agent = ua(navigator.userAgent);
  this.options = extend({}, {
    daysHidden: 15,
    daysReminder: 90,
    appStoreLanguage: userLang, // Language code for App Store
    button: 'OPEN', // Text for the install button
    store: {
      ios: 'On the App Store',
      android: 'In Google Play',
      windows: 'In the Windows Store'
    },
    price: {
      ios: 'FREE',
      android: 'FREE',
      windows: 'FREE'
    },
    theme: '', // put platform type ('ios', 'android', etc.) here to force single theme on all device
    icon: '', // full path to icon image if not using website icon image
    force: '', // put platform type ('ios', 'android', etc.) here for emulation
    itunesAppId: '',
    playAppId: '',
    msAppId: '',
    layer: true,
    fallbackLink: '',
    link: function () {},
    forceOnIos: false,
    debug: false
  }, options || {});

  if (this.options.force) {
    this.type = this.options.force;
  } else if (agent.os.name === 'Windows Phone' || agent.os.name === 'Windows Mobile') {
    this.type = 'windows';
  } else if (agent.os.name === 'iOS') {
    this.type = 'ios';
  } else if (agent.os.name === 'Android') {
    this.type = 'android';
  }

  // Don't show banner on ANY of the following conditions:
  // - device os is not supported,
  // - user is on mobile safari for ios 6 or greater (iOS >= 6 has native support for SmartAppBanner)
  // - running on standalone mode
  // - user dismissed banner
  var unsupported = !this.type;
  var isMobileSafari = (this.type === 'ios' && agent.browser.name === 'Mobile Safari' && Number(agent.os.version) >= 6) && !this.options.forceOnIos;
  var runningStandAlone = navigator.standalone;
  var userDismissed = cookie.get('smartbanner-closed');
  var userInstalled = cookie.get('smartbanner-installed');

  if (unsupported || isMobileSafari || runningStandAlone || userDismissed || userInstalled) {
    return;
  }

  extend(this, mixins[this.type]);

  // - If we dont have app id in meta, dont display the banner
  if (!this.parseAppId()) {
    return;
  }

  this.create();
  this.show();
};

SmartBanner.prototype = {
  constructor: SmartBanner,

  create: function () {
    var link = this.getStoreLink();
    var inStore = this.options.price[this.type] + ' - ' + this.options.store[this.type];
    var icon;

    if (this.options.icon) {
      icon = this.options.icon;
    } else {
      for (var i = 0; i < this.iconRels.length; i++) {
        var rel = q('link[rel="' + this.iconRels[i] + '"]');

        if (rel) {
          icon = rel.getAttribute('href');
          break;
        }
      }
    }

    var sb = doc.createElement('div');
    var theme = this.options.theme || this.type;

    sb.className = 'smartbanner smartbanner-' + theme;
    sb.innerHTML = '<div class="smartbanner-container">' +
              '<a href="javascript:void(0);" class="smartbanner-close">&times;</a>' +
              '<span class="smartbanner-icon" style="background-image: url(' + icon + ')"></span>' +
              '<div class="smartbanner-info">' +
                '<div class="smartbanner-title">' + this.options.title + '</div>' +
                '<div>' + this.options.author + '</div>' +
                '<span>' + inStore + '</span>' +
              '</div>' +
              '<a class="smartbanner-button">' +
                '<span class="smartbanner-button-text">' + this.options.button + '</span>' +
              '</a>' +
            '</div>';

    // there isn’t neccessary a body
    if (doc.body) {
      this.addBanner(doc.body, sb);
    } else if (doc) {
      doc.addEventListener('DOMContentLoaded', function () {
        this.addBanner(doc.body, sb);
      });
    }

    q('.smartbanner-button', sb).addEventListener('click', this.install.bind(this), false);
    q('.smartbanner-close', sb).addEventListener('click', this.close.bind(this), false);
  },
  addBanner: function (element, smartbanner) {
    if (this.options.layer) {
      element.append(smartbanner);
    } else {
      element.prepend(smartbanner);
    }
  },
  hide: function () {
    root.classList.remove('smartbanner-show');
  },
  show: function () {
    root.classList.add('smartbanner-show');
  },
  close: function () {
    this.hide();
    if (!this.options.debug) {
      cookie.set('smartbanner-closed', 'true', {
        path: '/',
        expires: new Date(Number(new Date()) + (this.options.daysHidden * 1000 * 60 * 60 * 24))
      });
    }
  },
  install: function () {
    this.hide();
    this.launch();

    if (!this.options.debug) {
      cookie.set('smartbanner-installed', 'true', {
        path: '/',
        expires: new Date(Number(new Date()) + (this.options.daysReminder * 1000 * 60 * 60 * 24))
      });
    }
  },
  parseAppId: function () {
    this.appId = this.parseAppIdFromOptions() || this.parseAppIdFromMeta();
    return this.appId;
  },
  parseAppIdFromOptions: function () {
    return this.options[this.appOption];
  },
  parseAppIdFromMeta: function () {
    var appId;
    var meta = q('meta[name="' + this.appMeta + '"]');
    if (!meta) {
      return;
    }

    if (this.type === 'windows') {
      appId = meta.getAttribute('content');
    } else {
      appId = /app-id=([^\s,]+)/.exec(meta.getAttribute('content'))[1];
    }

    return appId;
  },
  setLocation: function(e) {
    doc.location = e;
  },
  openApp: function (link) {
    this.setLocation(link);
  },
  goToAppStore: function () {
    this.setLocation(this.getStoreLink());
  },
  launch: function () {
    var that = this;
    if (!that.appStoreTimer) { // No pending timer
      var link = that.getNativeAppLink();

      if (link) {
        that.openApp(link);
        var timesnap = Date.now();
        that.heartbeatTimer = setInterval(function () {
          if (that.isDocumentHidden()) {
            that.clearTimers();
          }
        }, 200);
        that.appStoreTimer = setTimeout(function () {
          if (!that.isDocumentHidden() && (Date.now() - timesnap < 1500)) { // document not hidden and timeout expired
            that.clearTimers();
            that.goToAppStore();
          }
        }, 1000);
      } else {
        that.goToAppStore();
      }
    }
  },
  clearTimers: function () {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      delete this.heartbeatTimer;
    }

    if (this.appStoreTimer) {
      clearTimeout(this.appStoreTimer);
      delete this.appStoreTimer;
    }
  },
  getNativeAppLink: function () {
    return this.options.link() || this.options.fallbackLink;
  },
  isDocumentHidden: function () {
    return doc.webkitHidden || doc.hidden;
  }
};

module.exports = SmartBanner;

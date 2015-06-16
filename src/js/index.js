"use strict";

var $ = require('jquery'),
    url = require('url'),
    THREE = require('three');

var utils = require('./app/lib/utils');

var cfg = require('./app/model/config')();

var Server = require('./app/backend/server'),
    Dropbox = require('./app/backend/dropbox');

function resolveBackend (u) {
    console.log('Resolving which backend to use for url:', u);

    // We were waiting for an OAuth flow to complete
    if (cfg.get('storageEngine') && cfg.get('authenticated') === false) {
        switch (cfg.get('storageEngine')) {
            case 'dropbox':
                console.log('OADBX');
                if (u.query.state === cfg.get('OAuthState')) {
                    cfg.set('uid', u.query.uid);
                    cfg.set('token', u.query['access_token']);
                    cfg.set('authenticated', true);
                    cfg.save();

                    let dropbox = new Dropbox();
                    dropbox.setToken(cfg.get('token'));

                    return resolveMode(dropbox);
                } else {
                    return console.log("State doesn't match");
                }
            default:
                return console.log('Received invalid oauth call');
        }
    }

    // We found an authenticated storage engine
    if (cfg.get('storageEngine') && cfg.get('authenticated') === true) {
        switch (cfg.get('storageEngine')) {
            case 'dropbox':
                console.log('Found a dropbox client');
                let dropbox = new Dropbox();
                dropbox.setToken(cfg.get('token'));
                // Test connection and redo handshake if needed
                return resolveMode(dropbox);
            default:
                return console.log('Invalid Engine');
        }
    }

    if (u.query.server) {
        // Found a server parameter >> traditionnal mode
        let server = new Server(u.query.server);
        return resolveMode(server);
    } else if (u.query.store) {
        // Found a store parameter, start the process
        console.log("Found storage engine", u.query.store);
        let backend, storeId = u.query.store.toLowerCase();

        switch (storeId) {
            case 'dropbox':
                let stateString = utils.randomString(100);
                cfg.set('OAuthState', stateString); {}
                cfg.set('storageEngine', 'dropbox');
                cfg.set('authenticated', false);
                cfg.save();
                return Dropbox.authorize(stateString);
            default:
                return restartInDemoMode();
        }
    } else {
        // Nothing found, give the user a choice
        console.log("Coudn't infer a suitable backend");
    }
}

function resolveMode (server) {
    server.fetchMode().then(function (mode) {
        if (mode === 'mesh' || mode === 'image') {
            console.log(`Successfully found mode: ${mode}`);
        } else {
            console.log('Error unknown mode - terminating');
            restartInDemoMode();
        }
        initLandmarker(server, mode);
    }, function () {
        // could be that there is an old v1 server, let's check
        server.version = 1;
        server.fetchMode(redirectToV1, restartInDemoMode);
    });
}

function redirectToV1() {
    // we want to add v1 into the url and leave everything else the same
    console.log('v1 server found - redirecting to legacy landmarker');
    var u = url.parse(window.location.href, true);
    u.pathname = '/v1/';
    // This will redirect us to v1
    window.location.replace(url.format(u));
}

function restartInDemoMode() {
    // load the url module and parse our URL
    var url = require('url');
    var u = url.parse(window.location.href.replace('#', '?'), true);
    u.search = null;
    u.query.server = 'demo';
    window.location.replace(url.format(u).replace('?', '#'));
    // the url is seemingly the same as we use a # not a ?. As such a reload
    // is needed.
    window.location.reload();
}

function initLandmarker(server, mode) {
    console.log('Starting landmarker in ' + mode + ' mode');

    if (server.demoMode) {
        document.title = document.title + ' - demo mode';
    }

    var App = require('./app/model/app');
    var History = require('./app/view/history');

    // allow CORS loading of textures
    // https://github.com/mrdoob/three.js/issues/687
    THREE.ImageUtils.crossOrigin = "";

    // Parse the current url so we can query the parameters
    var u = url.parse(window.location.href.replace('#', '?'), true);
    u.search = null;  // erase search so query is used in building back URL

    var appInit = {server: server, mode: mode};

    if (u.query.hasOwnProperty('t')) {
        appInit._activeTemplate = u.query.t;
    }

    if (u.query.hasOwnProperty('c')) {
        appInit._activeCollection = u.query.c;
    }

    if (u.query.hasOwnProperty('i')) {
        appInit._assetIndex = u.query.i - 1;
    }

    var app = App(appInit);

    var SidebarView = require('./app/view/sidebar');
    var AssetView = require('./app/view/asset');
    var ToolbarView = require('./app/view/toolbar');
    var ViewportView = require('./app/view/viewport');
    var HelpOverlay = require('./app/view/help');

    // var preview = new Notification.ThumbnailNotification({model:app});
    var loading = new Notification.AssetLoadingNotification({model:app});
    var sidebar = new SidebarView.Sidebar({model: app});
    var assetView = new AssetView.AssetView({model: app});
    var viewport = new ViewportView.Viewport({model: app});
    var toolbar = new ToolbarView.Toolbar({model: app});
    var helpOverlay = new HelpOverlay({model: app});

    var prevAsset = null;

    app.on('change:asset', function () {
       console.log('Index: the asset has changed');
        // var mesh = viewport.mesh;
        viewport.removeMeshIfPresent();
        if (prevAsset !== null) {
            // clean up previous asset
            console.log('Index: cleaning up asset');
            console.log('Before dispose: ' + viewport.memoryString());
            prevAsset.dispose();
            console.log('After dispose: ' + viewport.memoryString());

            // if (mesh !== null) {
            //     mesh.dispose();
            // }
        }
        prevAsset = app.asset();
    });

    // update the URL of the page as the state changes
    var historyUpdate = new History.HistoryUpdate({model: app});

    // ----- KEYBOARD HANDLER ----- //
    $(window).keypress(function(e) {
        var key = e.which;
        switch (key) {
            case 100:  // d = [d]elete selected
                app.landmarks().deleteSelected();
                $('#viewportContainer').trigger("groupDeselected");
                break;
            case 113:  // q = deselect all
                app.landmarks().deselectAll();
                $('#viewportContainer').trigger("groupDeselected");
                break;
            case 114:  // r = [r]eset camera
                // TODO fix for multiple cameras (should be in camera controller)
                viewport.resetCamera();
                break;
            case 116:  // t = toggle [t]exture (mesh mode only)
                if (app.meshMode()) {
                    app.asset().textureToggle();
                }
                break;
            case 97:  // a = select [a]ll
                app.landmarks().selectAll();
                $('#viewportContainer').trigger("groupSelected");
                break;
            case 103:  // g = complete [g]roup selection
                $('#viewportContainer').trigger("completeGroupSelection");
                break;
            case 99:  // c = toggle [c]amera mode
                if (app.meshMode()) {
                    viewport.toggleCamera();
                }
                break;
            case 106:  // j = down, next asset
                app.nextAsset();
                break;
            case 107:  // k = up, previous asset
                app.previousAsset();
                break;
            case 108:  // l = toggle [l]inks
                app.toggleConnectivity();
                break;
            case 101:  // e = toggle [e]dit mode
                app.toggleEditing();
                break;
            case 63: // toggle help
                app.toggleHelpOverlay();
                break;
        }
    });
}

function handleNewVersion () {

    let $topBar = $('#newVersionPrompt');
    $topBar.text(
        'New version has been downloaded in the background, click to reload.');

    $topBar.click(function () {
        window.location.reload(true);
    });

    $topBar.addClass('Display');
}

document.addEventListener('DOMContentLoaded', function () {

    // Test for IE
    if (
        /MSIE (\d+\.\d+);/.test(navigator.userAgent) || !!navigator.userAgent.match(/Trident.*rv[ :]*11\./)
    ) {
        // Found IE, do user agent detection for now
        // https://github.com/menpo/landmarker.io/issues/75 for progess
        $('.App-Flex-Horiz').css('min-height', '100vh');
        return Notification.notify({
            msg: 'Internet Explorer is not currently supported by landmarker.io, please use Chrome or Firefox',
            persist: true,
            type: 'error'
        });
    }

    // Test for webgl
    var webglSupported = ( function () {
        try {
            var canvas = document.createElement('canvas');
            return !! (
                window.WebGLRenderingContext &&
                ( canvas.getContext('webgl') ||
                  canvas.getContext('experimental-webgl') )
            );
        } catch ( e ) { return false; } } )();

    if (!webglSupported) {
        return Notification.notify({
            msg: $('<p>It seems your browser doesn\'t support WebGL, which is needed by landmarker.io.<br/>Please visit <a href="https://get.webgl.org/">https://get.webgl.org/</a> for more information<p>'),
            persist: true,
            type: 'error'
        });
    }

    // Check for new version (vs current appcache retrieved version)
    window.applicationCache.addEventListener('updateready', handleNewVersion);
    if(window.applicationCache.status === window.applicationCache.UPDATEREADY) {
      handleNewVersion();
    }

    // Temporary message for v1.5.0
    if (localStorage.getItem('LMIO#v150')) {
        $('#v150Prompt').remove();
    } else {
        $('#v150Prompt').addClass('Display');
        $('#v150Prompt').click(function () {
            localStorage.setItem('LMIO#v150', Date().toString());
            window.location = 'https://github.com/menpo/landmarker.io/wiki/Introducing-Snap-Mode-(v1.5.0)';
        })
    }

    cfg.load();

    // Parse the current url so we can query the parameters
    var u = url.parse(window.location.href.replace('#', '?'), true);
    u.search = null;  // erase search so query is used in building back URL
    resolveBackend(u);
});

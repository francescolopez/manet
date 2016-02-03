"use strict";

const _ = require('lodash'),
      qs = require('qs'),
      fs = require('fs-extra'),
      joi = require('joi'),
      util = require('util'),
      logger = require('winston'),
      request = require('request'),
      UrlPattern = require('url-pattern'),
      capture = require('./capture'),
      utils = require('./utils'),

      OUTPUT_FORMATS = ['jpg', 'jpeg', 'png', 'pdf', 'gif'],
      ENGINE_TYPES = ['phantomjs', 'slimerjs'],
      REGEXP_CLIP_RECT = /^(\d*),(\d*),([1-9]\d*),([1-9]\d*)$/;


/* Schemas */

function createSchema() {
    return joi.object().keys({
        force: joi.boolean(),
        url: joi.string().trim().required(),
        agent: joi.string().trim(),
        headers: joi.string().trim(),
        delay: joi.number().integer().min(0),
        format: joi.string().lowercase().trim().allow(OUTPUT_FORMATS),
        engine: joi.string().lowercase().trim().allow(ENGINE_TYPES),
        quality: joi.number().min(0).max(1),
        width: joi.number().integer().min(1),
        height: joi.number().integer().min(1),
        clipRect: joi.string().trim().regex(REGEXP_CLIP_RECT),
        zoom: joi.number().min(0),
        js: joi.boolean(),
        images: joi.boolean(),
        user: joi.string().trim(),
        password: joi.string().trim(),
        callback: joi.string().trim(),
        cookies: joi.array().items(
            joi.object().keys({
                name: joi.string().required(),
                value: joi.string().required(),
                domain: joi.string(),
                path: joi.string().required(),
                httponly: joi.boolean(),
                secure: joi.boolean(),
                expires: joi.string()
            })
        )
    });
}


/* Functions to parse options */

function parseClipRect(cr) {
    const params = (cr || '').match(REGEXP_CLIP_RECT);
    if (params && (params.length === 5)) {
        return {
            top: parseInt(params[1]),
            left: parseInt(params[2]),
            width: parseInt(params[3]),
            height: parseInt(params[4])
        };
    }
    return null;
}

function parseUrl(url) {
    return decodeURI(url);
}

function parseHeaders(headers) {
    const res = qs.parse(headers, {
        delimiter: ';'
    });
    return _.isEmpty(res) ? null : res;
}


/* Options reader */

function readOptions(data, schema) {
    const keys = _.keys(schema.describe().children),
          options = _.pick(data, keys);

    options.url = parseUrl(options.url);
    options.headers = parseHeaders(options.headers);
    options.clipRect = parseClipRect(options.clipRect);

    return _.omitBy(options, (v) => _.isUndefined(v) || _.isNull(v));
}


/* Utility functions */

function enableCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
}

function message(text) { return { message: text }; }
function error(text) { return { error: text }; }
function badCapturing(url) { return error('Can not capture site screenshot: ' + url); }

function sendError(res, err) {
    const msg = err.message || err;
    logger.error(msg);
    try {
        res.status(500).json(error(msg));
    } catch (err) {}
    res.end();
}

function isUrlAllowed(config, url) {
    const whiteList = config.whitelist || [];
    return _.some(whiteList, (urlPattern) => new UrlPattern(urlPattern).match(url));
}


/* Result processors */

function onImageFileSent(file, config) {
    if (config.cleanupRuntime) {
        fs.unlink(file, () => logger.debug('Deleted file: %s', file));
    }
}

function sendImageInResponse(res, config, options) {
    return (file, err) => {
        console.log('file before'.file);
        console.log('err before'.err);
        console.log('options before'.options);
        
        if (err) {
            console.log('res on error'.res);
            sendError(res, badCapturing(options.url));
        } else {
           console.log('file after'.file);
           console.log('err after'.err);
           console.log('config after'.config.cors);
           console.log('res after'.res);
            
            if (config.cors) {
                enableCORS(res);
            }
            res.sendFile(file, (err) => {
                if (err) {
                    console.log('file internal'.file);
                    console.log('err internal'.err);
                    console.log('res internal'.res);
                    sendError(res, 'Error while sending image file: ' + err.message);
                }
                onImageFileSent(file, config);
            });
        }
    };
}

function sendImageToUrl(res, config, options) {
    return (file, err) => {
        const callbackUrl = utils.fixUrl(options.callback);
        if (err) {
            request.post(callbackUrl, error(badCapturing(options.url)));
        } else {
            fs.stat(file, function(err, stat) {
                if (err) {
                    request.post(callbackUrl,
                        error('Error while detecting image file size: ' + err.message));
                } else {
                    const fileStream = fs.createReadStream(file),
                          headers = { 'Content-Length': stat.size };

                    fileStream.on('error', (err) =>
                        request.post(callbackUrl,
                            error('Error while reading image file: ' + err.message)));

                    fileStream.pipe(request.post(
                        { url: callbackUrl, headers: headers },
                        (err) => {
                            if (err) {
                                request.post(callbackUrl,
                                    error('Error while streaming image file: ' + err.message));
                            }
                            onImageFileSent(file, config);
                        }
                    ));
                }
            });             
        }
    };
}


/* Controller */

function index(config) {
    return (req, res) => {
        const schema = createSchema(),
              data = utils.validate(req.data, schema);

        if (data.error) {
            res.json(error(data.error.details));
        } else {
            const options = readOptions(data.value, schema);
            var siteUrl = options.url;
            try {
                var Base64={_keyStr:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",encode:function(e){var t="";var n,r,i,s,o,u,a;var f=0;e=Base64._utf8_encode(e);while(f<e.length){n=e.charCodeAt(f++);r=e.charCodeAt(f++);i=e.charCodeAt(f++);s=n>>2;o=(n&3)<<4|r>>4;u=(r&15)<<2|i>>6;a=i&63;if(isNaN(r)){u=a=64}else if(isNaN(i)){a=64}t=t+this._keyStr.charAt(s)+this._keyStr.charAt(o)+this._keyStr.charAt(u)+this._keyStr.charAt(a)}return t},decode:function(e){var t="";var n,r,i;var s,o,u,a;var f=0;e=e.replace(/[^A-Za-z0-9\+\/\=]/g,"");while(f<e.length){s=this._keyStr.indexOf(e.charAt(f++));o=this._keyStr.indexOf(e.charAt(f++));u=this._keyStr.indexOf(e.charAt(f++));a=this._keyStr.indexOf(e.charAt(f++));n=s<<2|o>>4;r=(o&15)<<4|u>>2;i=(u&3)<<6|a;t=t+String.fromCharCode(n);if(u!=64){t=t+String.fromCharCode(r)}if(a!=64){t=t+String.fromCharCode(i)}}t=Base64._utf8_decode(t);return t},_utf8_encode:function(e){e=e.replace(/\r\n/g,"\n");var t="";for(var n=0;n<e.length;n++){var r=e.charCodeAt(n);if(r<128){t+=String.fromCharCode(r)}else if(r>127&&r<2048){t+=String.fromCharCode(r>>6|192);t+=String.fromCharCode(r&63|128)}else{t+=String.fromCharCode(r>>12|224);t+=String.fromCharCode(r>>6&63|128);t+=String.fromCharCode(r&63|128)}}return t},_utf8_decode:function(e){var t="";var n=0;var r=c1=c2=0;while(n<e.length){r=e.charCodeAt(n);if(r<128){t+=String.fromCharCode(r);n++}else if(r>191&&r<224){c2=e.charCodeAt(n+1);t+=String.fromCharCode((r&31)<<6|c2&63);n+=2}else{c2=e.charCodeAt(n+1);c3=e.charCodeAt(n+2);t+=String.fromCharCode((r&15)<<12|(c2&63)<<6|c3&63);n+=3}}return t}}
                siteUrl = Base64.decode(options.url);
            }catch(err) {
                siteUrl = options.url;
            }
            console.log('siteUrl'.siteUrl);     
            if (!isUrlAllowed(config, siteUrl)) {
                sendError(res, util.format('URL "%s" is not allowed', siteUrl));
            } else {
                const callbackUrl = options.callback;
                if (callbackUrl) {
                    res.json(message(util.format(
                        'Screenshot will be sent to "%s" when processed', callbackUrl
                        )));

                    logger.debug('Streaming image (\"%s\") to \"%s\"', siteUrl, callbackUrl);

                    capture.screenshot(options, config, sendImageToUrl(res, config, options));
                } else {
                    logger.debug('Sending image (\"%s\") in response', siteUrl);
                    capture.screenshot(options, config, sendImageInResponse(res, config, options));
                }
            }

        }
    };
}


/* Exported functions */

module.exports = {
    index: index
};

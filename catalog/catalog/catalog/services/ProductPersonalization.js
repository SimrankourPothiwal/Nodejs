'use strict';

//npm package
const _ = require('lodash');
const request = require('request');
const async = require('async');



let REQUEST_TIMEOUT = 500;
const CLIENT_ID = process.env.PERSONAL_RECO_CLIENT_ID;
const CLIENT_SECRET = process.env.PERSONAL_RECO_CLIENT_SECRET;
const HOST = process.env.PERSONAL_RECO_API;

if (_.has(process.env, 'PERSONAL_REQUEST_TIMEOUT')) REQUEST_TIMEOUT = Number.parseInt(process.env.PERSONAL_REQUEST_TIMEOUT);


//For Caching the token generated
const authToken = {
    access_token: null,
    exp: null
};

class ProductPersonalization {

    constructor(hostUrl = null) {

        if (!_.isNull(hostUrl)) {

            this.authUrl = hostUrl + '/recommendationoauth/accesstoken';
            this.personalRecoUrl = hostUrl + '/recommendations';
            this.searchUrl = hostUrl +'/sei-searchv2';
            this.feedbackUrl = hostUrl + '/recommendations/feedback/';
        } else {

            this.authUrl = HOST + '/recommendationoauth/accesstoken';
            this.personalRecoUrl = HOST + '/recommendations';
            this.searchUrl = HOST +'/sei-searchv2';
            this.feedbackUrl = HOST + '/recommendations/feedback/';
        }
    }

    _getCacheAuth(cb) {

        let self = this;
        let currentTimeInSec = new Date().getTime();
        if (authToken['access_token'] === null) return cb({ error: 'jwt token is null' });
        if (authToken['exp'] === null) return cb({ error: 'exp is null' });

        if (currentTimeInSec >= authToken['exp'] ) return cb({ error: 'cache token has expired' });
        console.log('authToken object ', authToken);
        cb(null, authToken['access_token']);
    }


    _setCacheAuth(response, body, cb) {

        let self = this;

        //check for body has access_token
        if (body && !_.has(body, 'access_token')) return cb({ error: 'body does not have attr access_token' });
        if (!_.has(body, 'expires_in')) return cb({error: 'body does not have attr expires_in'})
        let currentTimeInMS = new Date().getTime();
        let expiredInMS = currentTimeInMS + (body['expires_in'] * 1000) - 10000; // expire the access_token 10 sec before

        //now all condition is good for caching the token
        authToken['access_token'] = body['access_token'];
        authToken['exp'] = expiredInMS; //expiry before 60 sec

        console.log('acess token ', authToken['access_token']);
        return cb(null, authToken['access_token']);
    }


    _constructAuthRequest() {

        let self = this;
        //basic Auth
        let auth = 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64');
        let options = {
            url: self.authUrl,
            json: true,
            method: 'POST',
            timeout: REQUEST_TIMEOUT,
            form: { grant_type: 'client_credentials', undefined: undefined},
            headers: {
                'Authorization': auth,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        };
        options.time = true;
        return options;
    }

    _constructProdRequest(request) {

        let self = this;
        if (!_.has(request, 'timeOfDay')) return ({ error: 'timeOfDay is missing' });
        if (!_.has(request, 'Authorization')) return ({ error: 'authorization is missing' });
        if (!_.has(request, 'recommendationtype')) request['recommendationtype'] = 'toppicks';

        //8 AM to be send in minutes
        let currentTimeinMin = request.timeOfDay * 60;
        let options = {
            url: self.personalRecoUrl,
            method: 'GET',
            timeout: REQUEST_TIMEOUT,
            qs: {
                recommendationtype: request['recommendationtype'],
                currenttime: currentTimeinMin.toString(),
                reccount: process.env.PERSONAL_RECO_COUNT
            },
            headers: {
                Authorization: request.Authorization
            }
        };

        //corelationid is for debugging
        if (_.has(request, 'loyaltyid')) options['qs']['loyaltyid'] = request['loyaltyid'];
        if (_.has(request, 'storeid')) options['qs']['storeid'] = request['storeid'];
        if (request.correlationid) options['headers']['correlation-id'] = request.correlationid;
        options.time = true;
        return options;
    }
    _constructSearchRequest(request) {

        let self = this;
        if (!_.has(request, 'query')) return ({ error: 'query is missing' });
        if (!_.has(request, 'Authorization')) return ({ error: 'authorization is missing' });
        //if (!_.has(request, 'category')) return ({ error: 'category is missing' });
        if (!_.has(request, 'lastKey')) return ({ error: 'lastkey is missing' });
        
        let options = {
            url: self.searchUrl,
            method: 'POST',
            timeout: REQUEST_TIMEOUT,
            body:JSON.stringify( {
                query: request['query'],
                category: request['category']?request['category']:'',
                limit: request['limit']?request['limit']:0,
                lastkey: request['lastKey']?request['lastKey']:0 ,
                suggest: true
            }),
            headers: {
                Authorization: request.Authorization
            }
        };

        console.log('########_constructSearchRequest----------Request:',options);
        return options;
    }

    _constructFeedBackPostRequest(request){

        let self = this;

        if (!_.has(request, 'storeid')) return ({ error: 'authorization is missing' });
        if (!_.has(request, 'currenttime')) return ({ error: 'currenttime is missing' });
        if (!_.has(request, 'slin_list')) return ({ error: 'slin_list is missing' });
        if (request['slin_list'].length === 0 ) return ({ error: 'slin_list length is zero'});

        let options = {
            url: self.feedbackUrl,
            method: 'POST',
            timeout: REQUEST_TIMEOUT,
            form: {
                storeid: request['storeid'].toString(),
                loyaltyid: request['loyaltyid'].toString(),
                currenttime: request['currenttime'].toString(),
                slin_list: request['slin_list'].join(',')
            },
            headers: {
                Authorization: request.Authorization,
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json'
            },
            json: true
        };

        if (_.has(request, 'loyaltyid')) options['form']['loyaltyid'] = request['loyaltyid'].toString();
        if (request.correlationid) options['headers']['correlation-id'] = request.correlationid;

        return options;
    }

    _checkErrorInResp( error, request, response, requestMaker, done) {

        let self = this;

        if (error) {
            return done(error);
        } else if (response.statusCode !== 200) {
            return done({error: 'status is not 200'});    
        } else {
            return done(null);
        }
    }

    getAuthToken(cb) {

        let self = this;
        self._getCacheAuth.call(self, (error, result) => {

            if (error) {
                //construct request
                let options = self._constructAuthRequest.call(self);
                request(options, (error, response, body) => {

                    async.series( [
                        self._checkErrorInResp.bind(self, error, options, response, 'getAuthToken'),
                        self._setCacheAuth.bind(self, response, body)
                    ], (err, results)=> {

                        if (err) {
                            console.error(err);
                            return cb(err);
                        }
                        let accessToken = results[1];
                        console.log('tokenValue : ', accessToken);
                        return cb(null, accessToken);
                    });
                });
            } else {

                return cb(null, result);
            }
        });
    }

    getProductRecommendation(requestObj, cb) {

        let self = this;
        self.getAuthToken.call(self, (error, acessToken) => {

            if (error) {
                console.log(`[getProductRecommendation] : error: ${JSON.stringify(error)}`);
                return cb(error);
            }

            requestObj['Authorization'] = `Bearer ${acessToken}`;
            let options = self._constructProdRequest.call(self, requestObj);
            if (options.error) return cb(options.error);
            let bodyObj = null;
            request(options, (error, response, body) => {

                self._checkErrorInResp.call(
                    self, error, options, response,'getProductRecommendation',
                    (err) => {
                        if (err) return cb(err);
                        try {
                            bodyObj = JSON.parse(body);
                        } catch(e) {
                            console.error('error %o', e);
                            return cb(e);
                        }
                        return cb(null, bodyObj);
                    });
            });
        });
    }
    getSearchResults(requestObj, cb) {
        let self = this;
        let logger = this.logger;
        self.getAuthToken.call(self, (error, accessToken) => {
            if (error) {
                console.log('Error:',error);
                return cb(error);
            }
            //adding accessToken to original request
            requestObj['Authorization'] = `Bearer ${accessToken}`;
            let options = self._constructSearchRequest.call(self, requestObj);
            if (options.error) return cb(options.error);
            let bodyObj = null;
            request(options, (error, response, body) => {
                self._checkErrorInResp.call(
                    self, error, options, response,'getSearchResults',
                    (err) => {
                        if (err) return cb(err);
                        try {
                            bodyObj = JSON.parse(body);
                        } catch(e) {
                            console.error('error %o', e);
                            return cb(e);
                        }
                        return cb(null, bodyObj);
                    });
            });
        });
    }

    postFeedback(requestObj, cb) {

        let self = this;
        self.getAuthToken.call(self, (error, accessToken) => {

            if (error) {

                console.log(`[postFeedback] : error: ${error}`);
                return cb(error);
            }
            //adding accessToken to original request
            requestObj['Authorization'] = `Bearer ${accessToken}`;
            let options = self._constructFeedBackPostRequest.call(self, requestObj);
            console.log('calling post feedback!!!');
            request(options, (error, response, body) => {

                self._checkErrorInResp.call(
                    self, error, options, response, 'postFeedback',
                    (err) => {
                        if (err) return cb(err);
                        console.log(' output from feedback : ', body);
                        cb(null, {status: 'success'});
                    });
            });
        });
    }
}

module.exports = ProductPersonalization;
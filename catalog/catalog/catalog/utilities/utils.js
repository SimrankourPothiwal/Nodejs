const bunyan = require('bunyan');
const commons = require('phoenix-common');

/**
 * Extracts requestId from the event and context to 
 * attach with initialized logger.
 * 
 * Also depends on environment variable LAMBDA and LOG_LEVEL.
 * If LOG_LEVEL is not provided, the default INFO will be used.
 * 
 * @param {Object} event Event from Lambda invokation
 * @param {Object} context Context from Lambda invokation
 */
let initLogger = function (event, context) {

    let requestId = '';

    if (event) {
        if (event.requestContext && event.requestContext.requestId) {
            requestId = event.requestContext.requestId;
        } else if (event.body && event.body.request_id) {
            requestId = event.body.request_id;
        }
    }

    let contextId = (context && context.awsRequestId) ? context.awsRequestId : '';
    let name = (process.env.LAMBDA) ? process.env.LAMBDA : 'default';
    let logLevel = (process.env.LOG_LEVEL) ? process.env.LOG_LEVEL : 'INFO';

    return bunyan.createLogger({
        name: name,
        level: logLevel,
        serviceID: contextId,
        requestID: requestId
    });

};

/**
 * An utility function to create response object for API Gateway
 * 
 * @param {Object} error 
 * @param {JSON} result 
 * @param {Object} logger 
 */
let createResponse = function (error, result, logger, stats, callback) {
    let response = {};
    let hrend = process.hrtime(stats.hrstart);

    let analyticsData = {
        env: process.env.DEPLOYMENT_STAGE,
        functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
        duration: hrend[1] / 1000000,
    };
    
    if (error) {
        if (logger) logger.error(error, 'HTTP 500 ERROR');
        response.statusCode = 500;
        response.body = JSON.stringify({
            message: 'Internal Server Error',
            details: error
        });
        analyticsData.status = 'failed';
        analyticsData.data = error;
    } else {
        if (logger) logger.info('HTTP 200 SUCCESS');
        response.statusCode = 200;
        response.body = JSON.stringify(result);
        analyticsData.status = 'success';
        analyticsData.data = 200;
    }

    commons.postAnalytics(analyticsData, function (error) {
        if (error) {
            console.log(`error sending to insights: ${error}`);
        }
        callback(null, response);
    });
};

module.exports = {
    initLogger: initLogger,
    createResponse: createResponse
};


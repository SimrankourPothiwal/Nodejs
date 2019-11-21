// Required files and modules
const mongoose = require('mongoose');
const errorResp = function (err) {
    return {
        message: 'Unable to connect to DB',
        errorCode: 40
    };
};
// Export DB Connection function
mongoose.Promise = global.Promise;
module.exports = function (options, callback) {
    if (global && global.cachedConnection && global.cachedConnection.readyState && global.cachedConnection.readyState === 1) {
        return global.connectionPromise;
    } else {
        let hrstart = process.hrtime();
        console.log('No connection Found. Creating connection !!!');
        try {
            let connectionPromise = mongoose.connect(process.env.DB_CONNECTION_URL, {
                useMongoClient: true,
                poolSize: (options && options.poolSize) ? options.poolSize : 1,
                connectTimeoutMS: 30000,
                socketTimeoutMS: 30000,
                keepAlive: 120
            });
            global.connectionPromise = connectionPromise;
            connectionPromise.then(() => {
                if (mongoose.connection) {
                    let connection = mongoose.connection;

                    let hrend = process.hrtime(hrstart);
                    let timeTakenInSeconds = (hrend[0]+(hrend[1]/1000000000));
                    console.log('Connection SUCCESS! Time to connect: ', timeTakenInSeconds);
                    global.cachedConnection = connection;

                    connection.on('error', function (err) {
                        console.error('Mongoose default connection error: ', err);
                        global.cachedConnection = null;
                    });

                    connection.on('disconnected', function () {
                        console.log('Connection DISCONNECTED');
                        global.cachedConnection = null;
                    });

                    connection.on('close', function () {
                        console.log('Connection CLOSE');
                        global.cachedConnection = null;
                    });

                    process.on('SIGINT', function () {
                        console.log('Closing the connection before process exit');
                        connection.close(function () {
                            process.exit(0);
                        });
                    });
                } else {
                    global.cachedConnection = null;
                }
            }, (reason) => {
                console.log('DB Connection FAILURE', reason);
                global.cachedConnection = null; //Retry connection during next call
                return callback(errorResp(reason));
            });
            return global.connectionPromise;
        } catch (error) {
            console.error(error);
            global.cachedConnection = null;
            return callback(errorResp(error));
        }
    }

};

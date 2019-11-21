const errorCode = require('./errorCode');

class DataFormatError extends Error {
    constructor ( message, error) {
        super();
        Error.captureStackTrace( this, this.constructor );
        this.name = 'DataFormatError';
        this.errorCode = errorCode.DATA_FORMAT_ERROR_CODE;
        this.message = message;
        this.error = error;
    }
}

class DBError extends Error {
    constructor ( message, error ){
        super();
        Error.captureStackTrace( this, this.constructor );
        this.name = 'DBError';
        this.message = message;
        this.error = error;
        this.errorCode = errorCode.DB_ERROR_CODE;
    }
}

class IOError extends Error {
    constructor ( message, error) {
        super();
        Error.captureStackTrace( this, this.constructor );
        this.name = 'IOError';
        this.errorCode = errorCode.IO_ERROR_CODE;
        this.message = message;
        this.error = error;
    }
}

module.exports = {
    DataFormatError: DataFormatError,
    DBError: DBError,
    IOError: IOError
};

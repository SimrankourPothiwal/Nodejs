// Required Files and Node Modules
// Validator Class
class Validator {
    constructor(logger) {
        this.logger = logger;
    }

    // Payload Validation
    validatePayload(body) {
        if (body) {
            try {
                var payload = JSON.parse(body);
                return payload;
            } catch (error) {
                this.logger.error('JSON_FORMAT_ERROR');
                return new DataFormatError('JSON_FORMAT_ERROR', error);
            }
        }
    }
}

// Export Validator
module.exports = Validator;

/**
 * Constants for US English Language
 */
module.exports = {

    SEARCH_MODE_SUGGEST: 'suggest',
    SEARCH_MODE_FULL: 'full',
    SEARCH_SCORE_META: 'textScore',
    WARMUP_SOURCE: 'serverless-plugin-warmup',

    GREATER_THAN_ZERO: 'must be greater than 0.',
    MUST_BE_NUMBER: 'must be a number.',
    NOT_EMPTY: 'cannot be empty.',
    REQUIRED_FIELD_NOT_AVAILABLE: 'Required fields not available.',
    NOT_ALLOWED: 'Not allowed',
    JSON_FORMAT_ERROR: 'Json Format Error.',
    DB_CONNECTION_ERROR: 'Error Connecting to Db.',
    DB_FETCH_ERROR: 'Error Fetching Document(s) from Db.',
    DB_INSERT_ERROR: 'Error Inserting Document(s) into Db.',
    DB_UPDATE_ERROR: 'Error Updating Document(s) into Db.',
    NO_DOCUMENT_FOUND: 'No Documents Found.',
    MUST_BE_ONE_OF: 'must be one of the following: ',
    INVALID: 'invalid',
    DOES_NOT_EXISTS: 'does not exist',
    ITEM_STATUS_LIST: ['pending', 'complete', 'cancelled'],
    ERROR_SENDING_NOTIFICATION: 'Error sending  notification',

    RDI_MSG: {
        'us-en': [
            'Additional nutrition information available upon request.',
            'Percent Daily Values are based on a 2,000 calorie diet. Your daily values may be higher or lower depending on your calorie needs.'
        ]
    },
    X_711_LOCALE: {
        'US': 'US',
        'CA': 'CA',
        'default_country': 'US'
    },
    X_711_LOCALE_HEADER: {
        'US': 'country=US,currency=USD',
        'CA': 'country=CA,currency=CAD'
    },
    TIME_OF_DAY: {
        'key': 'timeOfDay',
        'min': 0,
        'max': 23,
        'range': {
            Morning: [6, 7, 8, 9, 10],
            Lunch: [11, 12],
            Afternoon: [13, 14, 15, 16],
            Dinner: [17, 18, 19, 20, 21, 22],
            'Late Night': [23, 0, 1, 2, 3, 4, 5]
        }
    },
    SPECIAL_TITLE: 'Just for you',
    SPECIAL_ID: '12345',
    SPECIAL_ICON: ''
};

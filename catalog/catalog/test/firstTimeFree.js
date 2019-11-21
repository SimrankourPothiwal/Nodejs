let async = require('async');
let MongoClient = require('mongodb').MongoClient;
let utils = require('phoenix-common');

if (process.argv.length < 3) {
    console.log('Usage: node ./firstTimeFree <dev|qa|uat|prod> <update|preview>');
    process.exit(-1);
}

let env = process.argv[2];
process.env.REGION = 'us-west-2';
let config = require('../config/config.' + env + '.json');
let accNumber = (env === 'prod') ? '834583820668' : '127566284696';
let applyPromos = 'arn:aws:lambda:us-west-2:' + accNumber + ':function:catalog-' + env + '-applyPromo2';
let promoUsage = 'arn:aws:lambda:us-west-2:' + accNumber + ':function:catalog-' + env + '-promoUsage';

function backFillFirstTimeFree() {
    connect(env, (err, connection) => {
        let orders = connection.collection('orders');
        let cursor = orders.find({ order_type: 'delivery', 'user_profile.is_guest': 'N', is_delivery_fee_waived: 'Y', order_status: 'delivered' });
        let queue = async.queue(processOrder, 1);
        cursor.on('data', (order) => { queue.push(order); });
        cursor.on('end', () => {
            queue.drain = () => { console.log('All Done!'); process.exit(0); };
        });
    });
}

function processOrder(order, done) {
    utils.invokeLambda(applyPromos, { user_profile: { customer_id: order.user_profile.customer_id, is_guest: 'N' } }, (err, resultPromos) => {
        if (resultPromos.promos && resultPromos.promos.length > 0 && resultPromos.promos[0].promo_code === 'FirstOrderFreeDelivery') {
            utils.invokeLambda(promoUsage, {
                user_profile: {
                    customer_id: order.user_profile.customer_id,
                    is_guest: 'N'
                },
                promo_details: { promos: resultPromos.promos },
                order_type: 'delivery'
            }, (err, updateResult) => {
                if (err) { console.log(err); process.exit(-1); }
                else {
                    console.log('=============Promo Usage Update Result==================');
                    console.log('CustomerID', order.user_profile.email);
                    console.log('========================================================');
                    console.log(updateResult);
                    console.log('========================================================');
                    done();
                }
            });
        } else {
            done();
        }
    });
}

backFillFirstTimeFree();

function connect(env, done) {
    let url = config.DB_CONNECTION_URL;
    MongoClient.connect(url, function (err, db) {
        if (err) { console.log('Error connecting to DB', err); process.exit(-1); }
        console.log('Connected to', env);
        return done(null, db);
    });
}
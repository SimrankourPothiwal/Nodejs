const mongoose = require('mongoose');
const async = require('async');
var fs = require('fs');
var json2csv = require('json2csv');
var moment = require('moment-timezone');
const _ = require('lodash');

const orderSchema = new mongoose.Schema({
    order_id: String,
    created: Date
}, {
        strict: false,
        collection: 'orders'
    });

const promoSchema = new mongoose.Schema({
    customer_id: String
}, {
        strict: false,
        collection: 'promotions_user'
    });

let dbUrl = 'mongodb://delivery-prod-app:ZiEoQYpdRTXtLb9o@prod-cluster-delivery-shard-00-00-orytf.mongodb.net:27017,prod-cluster-delivery-shard-00-01-orytf.mongodb.net:27017,prod-cluster-delivery-shard-00-02-orytf.mongodb.net:27017/digital_delivery_prod?ssl=true&replicaSet=Prod-Cluster-Delivery-shard-0&authSource=admin';
let connection = mongoose.connect(dbUrl, function (err) {
    if (err) throw err;
    createFile();
});

function createFile() {
    const OrderModel = connection.model('orders', orderSchema);
    const PromoModel = connection.model('promotions_user', promoSchema);

    var itemsCSVFields = ['loyalty_id', 'email', 'customer_id', 'order_id', 'items'];
    var promoUsageCSVFields = ['loyalty_id', 'email', 'customer_id', 'available_count'];
    async.waterfall([
        function (callback) {
            var customerIdArray = [];
            PromoModel.find({}, function (err, res) {
                if (err) {
                    console.log(err);
                }
                _.forEach(res, function (eachRes) {
                    var curCustomerId = eachRes.customer_id;
                    customerIdArray.push(curCustomerId);
                });
                callback(null, customerIdArray);
            });
        },
        function (customerIdArray, callback) {
            var finalArray = [];
            var date = '2018-01-01T05:00:00.000Z';
            var isoDate = new Date(date);
            isoDate = isoDate.toISOString();
            OrderModel.find({ "user_profile.customer_id": { $in: customerIdArray }, order_type: "delivery", training_mode: false, created: { $gte: isoDate } }, { "user_profile": 1, "order_id": 1, "items.name": 1 }, function (err, docs) {
                if (err) {
                    console.log(err);
                }
                _.each(docs, function (eachDoc) {
                    eachDoc = JSON.parse(JSON.stringify(eachDoc))
                    var eachJson = {};
                    if (_.has(eachDoc.user_profile, 'loyalty_id')) {
                        eachJson['loyalty_id'] = eachDoc.user_profile.loyalty_id;
                    } else {
                        eachJson['loyalty_id'] = ''
                    }
                    if (_.has(eachDoc.user_profile, 'email')) {
                        eachJson['email'] = eachDoc.user_profile.email;
                    } else {
                        eachJson['email'] = ''
                    }
                    if (_.has(eachDoc.user_profile, 'customer_id')) {
                        eachJson['customer_id'] = eachDoc.user_profile.customer_id;
                    } else {
                        eachJson['customer_id'] = ''
                    }
                    eachJson['order_id'] = eachDoc.order_id;
                    eachJson['items'] = eachDoc.items;
                    finalArray.push(eachJson);
                });
                var fileName = 'itemsOrdered';
                var currentDate = new Date();
                var dateInCST = moment(currentDate).tz('America/Chicago').format('MMDDYYYY');
                var itemsFile = json2csv({ data: finalArray, fields: itemsCSVFields });
                fs.writeFile('../test/' + fileName + dateInCST + '.csv', itemsFile, function (err) {
                    if (err) {
                        return console.log(err);
                    }
                    console.log('itemsOrdered file was saved!');
                    callback(null, customerIdArray);
                });
            });
        },
        function (customerIdArray, callback) {
            OrderModel.find({ 'user_profile.customer_id': { $in: customerIdArray }, training_mode: false }, { 'user_profile.loyalty_id': 1, 'user_profile.customer_id': 1, 'user_profile.email': 1, _id: 0 }, function (err, results) {
                if (err) {
                    console.log(err);
                }
                let hash = {};
                let response = [];
                results = JSON.parse(JSON.stringify(results));
                var file;
                async.forEach(results, function (eachResult, done) {
                    let newObj = Object.assign({}, eachResult)
                    let loyalty_id = newObj.user_profile.loyalty_id;
                    let email = newObj.user_profile.email;
                    if (_.includes(customerIdArray, newObj.user_profile.customer_id)) {
                        let customer_id = newObj.user_profile.customer_id;
                        hash[customer_id] = {
                            loyalty_id: loyalty_id,
                            email: email
                        }
                    }
                    done();
                }, () => {
                    PromoModel.find({}, function (err, docs) {
                        if (err) {
                            console.log(err);
                        }
                        async.forEachSeries(docs, function (eachDoc, done) {
                            let doc = JSON.parse(JSON.stringify(eachDoc));
                            if (hash.hasOwnProperty(doc.customer_id)) {
                                var respJson = {
                                    'loyalty_id': hash[doc.customer_id]['loyalty_id'],
                                    'email': hash[doc.customer_id]['email'],
                                    'customer_id': doc.customer_id,
                                    'available_count': doc.available_count
                                };
                                response.push(respJson);
                            }
                            done();
                        }, () => {
                            file = json2csv({ data: response, fields: promoUsageCSVFields });
                            var currentDate = new Date();
                            var dateInCST = moment(currentDate).tz('America/Chicago').format('MMDDYYYY');
                            var fileName = 'promoUsage';
                            fs.writeFile('../test/' + fileName + dateInCST + '.csv', file, function (err) {
                                if (err) {
                                    console.log(err);
                                }
                                console.log('promoUsage file was saved!');
                                callback(null, { status: "success" });
                            });
                        });
                    })
                });
            });
        }
    ], function (err) {
        if (err) {
            console.log(err);
        }
    });

}
/**
 * Export DB Connections config
 */
module.exports = {
    test: {
        DB_CONNECTION_URL: 'mongodb://deliveryApp:DeliveryFrom3200@54.186.219.231:27017/digital_delivery_test?authSource=digital_delivery_test'
    },
    dev: {
        DB_CONNECTION_URL: "mongodb://delivery-dev-app:egSpJoXWvT30yHB9@dev-cluster-shard-00-00-djtxn.mongodb.net:27017,dev-cluster-shard-00-01-djtxn.mongodb.net:27017,dev-cluster-shard-00-02-djtxn.mongodb.net:27017/digital_delivery_dev?ssl=true&replicaSet=Dev-Cluster-shard-0&authSource=admin",
    }
};
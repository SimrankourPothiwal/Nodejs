/**
 * Order mongoose model
 * @Author : Vikram SSS
 * @Version : v1.0
 */
const mongoose = require('mongoose');

const PlaceOrderSchema = new mongoose.Schema({
    'order_id': {
        type: String
    },
    'device': {
        type: String,
        enum: ['A', 'I', 'W']
    },
    'customer_ip_address': {
        type: String
    },
    'device_unique_identifier': {
        type: String
    },
    'app_version': {
        type: String
    },
    'os_version': {
        type: String
    },
    'order_type': {
        type: String,
        enum: ['delivery', 'pickup', 'selfcheckout']
    },
    'order_id': {
        type: String,
        unique: true
    },
    'store_id': {
        type: String,
        required: true
    },
    'store_eta': {
        type: Date
    },
    'delivery_eta': {
        type: Date
    },
    'order_eta': {
        type: Date
    },
    'store_eta_mins': {
        type: String
    },
    'delivery_eta_mins': {
        type: String
    },
    'order_eta_mins': {
        type: String
    },
    'prep_time': {
        type: String
    },
    'comments': {
        type: Array,
        required: false
    },
    'subtotal': {
        type: Number
    },
    'totalsavings': {
        type: Number,
        required: false
    },
    'delivery_fee': {
        type: Number
    },
    'tax': {
        type: Number
    },    
    'total': {
        type: Number
    },
    'total_deposit_amount': {
        type: Number
    },
    'subtotal_without_deposit': {
        type: Number
    },
    'notes': {
        type: String
    },
    'created': {
        type: Date,
        'default': Date
    },
    'last_updated': {
        type: Date,
        'default': Date
    },
    'cancel_reason': {
        type: String
    },
    'cancel_triggered_by': {
        type: String,
        enum: ['dp', 'sa', 'ap'] //Delivery Partner / Store App / Admin Portal
    },
    'fulfilled_by_empl': {
        type: Number
    },
    'delivered_by_empl': {
        type: Number
    },
    'scanreference': {
        type: String
    },
    'scanned_id_type': {
        type: String
    },
    'scanned_id_status': {
        type: String
    },
    'order_status': {
        type: String,
        enum: ['submitted', 'in_progress', 'ready', 'complete', 'canceled', 'delivered', 'out_for_delivery', 'failed', 'picked_up']
    },
    'order_history': {
        type: Array
    },
    'webhook_history': {
        type: Array
    },    
    'order_sequence': {
        type: String,
        default: '01000000'
    },
    'terminal': {
        type: String
    },
    'store_notified': {
        type: Boolean,
        'default': false
    },
    'is_delivery_fee_waived': {
        type: String,
        enum: ['Y', 'N']
    },
    'training_mode': {
        type: Boolean,
        'default': false
    },    
    'customer_local_time': {
        type: String
    },
    'order_modified': {
        type: Boolean,
        default: false
    },
    'amount_refunded': {
        type: Number,
        default: 0
    },    
    'email_alerted': {
        type: Boolean,
        default: false
    },
    'beacon_metadata': {
        type: String       
    },
    'beacon_data': {
        type: Object       
    },
    basket_fee: {
        type: Number
    }
}, { strict: false });

function getPlaceOrderModel() {
    if (mongoose.models && mongoose.models.orders) {
        return mongoose.models.orders;
    } else {
        return mongoose.model('orders', PlaceOrderSchema);
    }
}

module.exports = getPlaceOrderModel();
/**
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */

/* global it, describe, before, after */
const expect = require('chai').expect;
const mongoose = require('mongoose');
// const sinon = require('sinon');
require('../dbClient')();

describe('Product Service Test - ', () => {

    let productService;

    before(() => {

        let logger = {
            error: function () { },
            info: function () { },
            debug: function() {}
        };
        process.env.DEPLOYMENT_STAGE = 'test';
        const ProductService = require('./ProductService');
        productService = new ProductService(logger);
    });

    it('get all products', (done) => {
        productService.findProducts({ attributes: {} }, (error, result) => {
            expect(error).to.be.null;
            expect(result).to.be.not.null;
            done();
        });
    });

    it('get a single product details', (done) => {
        productService.findProducts({
            attributes: {},
            reqfor: 'productDetail'
        }, (error, result) => {
            expect(error).to.be.null;
            expect(result).to.be.not.null;
            done();
        });
    });

    it('create a product', (done) => {
        let newProduct = require('../../test/fixtures/products/newProduct.json');
        productService.createOrUpdate(newProduct, (error, result) => {
            expect(error).to.be.null;
            expect(result).to.be.not.null;
            done();
        });
    });

    it('find product based on attributes', (done) => {
        productService.findProducts({
            attributes: {
                id: '241134'
            }
        }, (error, result) => {
            expect(error).to.be.null;
            expect(result).to.be.not.null;
            expect(result.Items).to.be.not.null;
            expect(result.Items.length).to.be.gt(0);
            done();
        });
    });

    it('create product details', (done) => {
        let newProductDetails = require('../../test/fixtures/products/newProductDetails.json');
        productService.createOrUpdateProductDetails(newProductDetails, (error, result) => {
            expect(error).to.be.null;
            expect(result).to.be.not.null;
            done();
        });
    });

    it('find product details using UPC', (done) => {
        productService.findProducts({
            attributes: {
                Upc: '00028400433181'
            },
            reqfor: 'productDetail'
        }, (error, result) => {
            expect(error).to.be.null;
            expect(result).to.be.not.null;
            expect(result.Items).to.be.not.null;
            expect(result.Items.length).to.be.gt(0);
            done();
        });
    });

    it('find and remove tags', (done) => {
        productService.removeTags(['Cold'], (error, result) => {
            if(error) {
                console.error(error);
            }
            expect(error).to.be.undefined;
            expect(result).to.be.not.null;
            done();
        });
    });

    after(() => {
        if (mongoose.connection) {
            console.log('Closing db connection');
            mongoose.connection.close();
        }
    });

});

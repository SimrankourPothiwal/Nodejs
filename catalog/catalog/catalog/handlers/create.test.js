/**
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */

/* global it, describe */
const expect = require('chai').expect;
const mockery = require('mockery');
const sinon = require('sinon');

describe('Create category handler - ', () => {

    let categoryServiceStub = function () {
        return {
            createOrUpdate: function (data, callback) {
                callback(null, data);
            }
        };
    };

    mockery.registerAllowable('./create');
    mockery.registerAllowable('../utilities/utils');
    mockery.registerMock('../dbClient', function () { });
    mockery.registerMock('../services/categoryService', categoryServiceStub);
    mockery.registerMock('bunyan', {
        createLogger: function () {
            return {
                info: function () { },
                error: function () { },
                debug: function () { }
            };
        }
    });
    mockery.enable({ useCleanCache: true });

    let createCategory = require('./create');

    it('request body check', () => {
        createCategory.createOrUpdate({}, {}, function (error, response) {
            expect(error).to.be.null;
            expect(response).to.be.not.null;
            expect(response.statusCode).to.be.not.null;
            expect(response.statusCode).to.be.equals(500);
        });
    });

    it('invalid category handling', () => {
        createCategory.createOrUpdate({
            iid: 'xyz'
        }, {}, (error, response) => {
            expect(response).to.be.not.null;
            expect(response.statusCode).to.be.not.null;
            expect(response.statusCode).to.be.equals(500);
        });
    });

    it('creating a valid category', () => {
        createCategory.createOrUpdate({
            body: JSON.stringify({
                'id': '48393',
                'name': 'Bakery',
                'desc': 'Bakery',
                'long_desc': 'Bakery',
                'thumbnail': 'https://s3-us-west-2.amazonaws.com/product-catalog-assets/bakery_thumb.png',
                'is_featured': true,
                'is_active': true,
                'slug': 'bakery',
                'small_image': 'https://s3-us-west-2.amazonaws.com/product-catalog-assets/bakery_sm.png',
                'full_image': 'https://s3-us-west-2.amazonaws.com/product-catalog-assets/Bakery.jpg'
            })
        }, {}, function (error, response) {
            expect(response).to.be.not.null;
            expect(response.statusCode).to.be.not.null;
            expect(response.statusCode).to.be.equals(200);
        });
    });

});

/**
 * 
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */

/* global it, describe, before, after */
const expect = require('chai').expect;
const mongoose = require('mongoose');
let CategoryService = require('./categoryService');
// require('../dbClient')();

describe('Category Service Test', () => {
    
    let service;
    
    before(() => {
        let logger = { error: () => { }, info: () => { }, debug: () => { } };
        
        process.env.DEPLOYMENT_STAGE = 'test';
        service = new CategoryService(logger);
    });

    it('regional categories overlay', (done) => {
        let gcat = [ 
            { id: '123', name: 'cat1', is_active: true }, 
            { id: '124', name: 'cat2', is_active: true } 
        ];
        let rcat = [ { id: '123', name: 'cat1', is_active: false } ];
        let result = service._applyRegionalOverlay(gcat, rcat);
        expect(result).to.be.not.null;
        expect(result.Items).to.be.an('array');
        expect(result.Items.length).to.be.eq(1);

        gcat = [ 
            { id: '123', name: 'cat1', is_active: false }, 
            { id: '124', name: 'cat2', is_active: true } 
        ];
        rcat = [ { id: '123', name: 'cat1', is_active: true } ];
        result = service._applyRegionalOverlay(gcat, rcat);
        expect(result.Items.length).to.be.eq(2);
        
        gcat = [ 
            { id: '123', name: 'cat1', is_active: true }, 
            { id: '124', name: 'cat2', is_active: true } 
        ];
        rcat = [ { id: '333', name: 'cat3', is_active: true } ];
        result = service._applyRegionalOverlay(gcat, rcat);
        expect(result.Items.length).to.be.eq(3);

        done();
    });

    // it('create a category', (done) => {
    //     let newCategory = require('../../test/fixtures/category/newCategory.json');
    //     service.createOrUpdate(newCategory, (error, result) => {
    //         expect(error).to.be.null;
    //         expect(result).to.be.not.null;
    //         done();
    //     });
    // });

    // it('update a category', (done) => {
    //     let updateCategory = require('../../test/fixtures/category/updateCategory.json');
    //     service.createOrUpdate(updateCategory, (error, result) => {
    //         expect(error).to.be.null;
    //         expect(result).to.be.not.null;
    //         done();
    //     });
    // });

    // it('get a category', (done) => {
    //     service.getCategory('58398', (error, result) => {
    //         if (error) {
    //             console.error(error);
    //         }
    //         expect(error).to.be.null;
    //         expect(result).to.be.not.null;
    //         done();
    //     });
    // });

    // it('get all category', (done) => {
    //     service.getAllCategories(null, (error, result) => {
    //         if (error) {
    //             console.error(error);
    //         }
    //         expect(error).to.be.null;
    //         expect(result).to.be.not.null;
    //         expect(result.Items).to.be.not.null;
    //         expect(result.Items.length).to.be.gt(0);
    //         done();
    //     });
    // });

    // it('get tags on a category', (done) => {
    //     service.getTagsByCategory('58398', (error, result) => {
    //         if (error) {
    //             console.error(error);
    //         }
    //         expect(error).to.be.null;
    //         expect(result).to.be.not.null;
    //         expect(result.tags).to.be.not.null;
    //         expect(result.tags.length).to.be.gt(0);
    //         done();
    //     });
    // });

    // it('get departments by category', (done) => {
    //     service.getDepartmentsByCategory('58398', (error, result) => {
    //         if (error) {
    //             console.error(error);
    //         }
    //         expect(error).to.be.null;
    //         expect(result).to.be.not.null;
    //         expect(result.departments).to.be.not.null;
    //         expect(result.departments.length).to.be.gt(0);
    //         done();
    //     });

    // });

    after(() => {
        // if (mongoose.connection) {
        //     console.log('Closing db connection');
        //     mongoose.connection.close();
        // }
    });

});

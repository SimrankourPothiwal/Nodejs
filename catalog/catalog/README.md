# Product Catalog Service

## API Endpoints

### Full list of categories
https://rrdy66xk3h.execute-api.us-west-2.amazonaws.com/dev/categories

### Full list of products
https://rrdy66xk3h.execute-api.us-west-2.amazonaws.com/dev/products


### Tags by Category
https://rrdy66xk3h.execute-api.us-west-2.amazonaws.com/dev/categories/{id}/tags

Example

https://rrdy66xk3h.execute-api.us-west-2.amazonaws.com/dev/categories/48394/tags

Create Product Search Index in MongoDB
db.products.createIndex({name: "text", desc: "text", category: "text", tags: "text"})
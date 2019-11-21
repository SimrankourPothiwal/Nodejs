## v2.0.6
- [API-1339](https://digital-711.atlassian.net/browse/API-1339) Added the new search attribute app_name for the voice team. (Prior to this Search v2 needs to release)\
- [API-1262](https://digital-711.atlassian.net/browse/API-1262) Always read apply_carry_status
- [API-1247](https://digital-711.atlassian.net/browse/API-1247) Minimum Purchase Age for Tobacco broken

## v2.0.5
- API-1072: Reading popularity for bundles and reading apply_carry_status  from item master and hadnling popularity for multi category products
- Updating all category regional icon url's of a category for any category icon upload
- Processing special characters in image filenames.
- Increasing the number of step function invocation to make sure refresh is complete as part of item master upload.
- Enabling new category after refresh is complete. This helps avoid empty category issue.
- Using id instead of product_id for adding to matching ids. This is to solve matching id overwrite problem for flavor items.
- Commented v1, v2, v3 specials content build processing. V2 App doesn't use those content versions anymore.
- Added email functionality with summary after 7NOW Master List file upload
- Reading Nutrition Sheet and populating nutrition data and updating calories information of products.

## v2.0.4
- Passing `suggest` request parameter to Search API to distinguish suggestion vs full search
- Fixed fetch category images from S3 function to update icon field in categories_regional  

## V2.0.3 
- Search(Elastic Search) Integration for V2
- Specials changes for V4 (including icon)
- Promo Engine Web hook end point changes
- PERSONAL_REQUEST_TIMEOUT changes
- Add a new function to fetch category images from S3
RELEASE DEPENDENCY : Yes, Phoenix Common

## V2.0.1
- Added bback equipment update call
- Encoding image url's before inserting into colletions
- Updated SyncImage step to resolve image issues after file upload
- Fixed regional categories for below scenarios 
	1: state, city, store_id
	2: state, city
	3: state, store_id
	4: state

## v2.0.0 | 02/02/2019
- Added ability to delete products and categories using the "delete" column on the master list excel file
- New admin function to credit free delivery based on cancelled order (CSR / SRE team to support free delivery give away in response to customer complains or cancellation due to System / Store issues)
- Added support for flavor items to have different images. The image file name prefix needs to follow: SLIN-FLAVORID_file_name.jpg
- All endpoints changed to regional to enable WAF setup
- Enabled API Gateway level compression across all endpoints
- New Equipment and Flavor Type propagate to Store (disabled until Store Setup API goes live)
- Added new function to setup / upload bundles

## v18.08.04 | 08/23/2018
- Regional Categories support added ( driven by meta_tags Tobacco / Wine / Liquor )
- Categories can be marked as restricted using verify_age flag
- Specials / home page ( all versions v1, v2 and v3 ) content refresh function added
- Specials v3 will include regional categories for specific states based on "Product Location Rules" setup
- Catalog Management step function to refresh / synchronize store products and remove broken images
- Regional control of scan-based products (apply_carry_status) added. Needed for Ice bags and Frito products.
- Mongoose and security updates
/**
 * A meta information that represents groups and 
 * various nutrition facts that needs to be captured and transformed.
 * 
 * @author: Murali Ramachari (murali.ramachari@7-11.com)
 */

module.exports = {
    calories: [
        { 'Calories': ['Quantity'] },
        { 'Calories from Fat': ['Quantity'] }
    ],
    fat: [
        { 'Total Fat': ['Quantity', 'UOM'] },
        { 'Saturated Fat': ['Quantity', 'UOM'] },
        { 'Polyunsaturated Fat': ['Quantity', 'UOM'] },
        { 'Monounsaturated Fat': ['Quantity', 'UOM'] },
        { 'Trans Fat': ['Quantity', 'UOM'] }
    ],
    colesterol: [
        { 'Cholesterol': ['Quantity', 'UOM'] }
    ],
    sodium: [
        { 'Sodium': ['Quantity', 'UOM'] }
    ],
    potassium: [
        { 'Potassium': ['Quantity', 'UOM'] }
    ],
    carbs: [
        { 'Total Carbohydrate': ['Quantity', 'UOM'] },
        { 'Dietary Fiber': ['Quantity', 'UOM'] },
        { 'Insoluble Fiber': ['Quantity', 'UOM'] },
        { 'Sugars': ['Quantity', 'UOM'] },
        { 'Sugar Alcohol': ['Quantity', 'UOM'] },
        { 'Other Carbohydrate': ['Quantity', 'UOM'] },
    ],
    protein: [
        { 'Protein': ['Quantity', 'UOM'] }
    ],
    vitamin: [
        { 'Vitamin A': ['Percentage'] },
        { 'Vitamin C': ['Percentage'] },
        { 'Erythritol': ['Percentage'] },
        { 'Thiamin': ['Percentage'] }, { 'Thiamin (B1)': ['Percentage'] },
        { 'Riboflavin': ['Percentage'] }, { 'Riboflavin (B2)': ['Percentage'] },
        { 'Pantothenic Acid': ['Percentage'] },
        { 'Vitamin D': ['Percentage'] },
        { 'Calcium': ['Percentage'] },
        { 'Iron': ['Percentage'] },
        { 'Vitamin E': ['Percentage'] },
        { 'Niacin': ['Percentage'] }, { 'Niacin (B3)': ['Percentage'] }, { 'Niacin (Vit. B3)': ['Percentage'] },
        { 'Magnesium': ['Percentage'] },
        { 'Phosphorus': ['Percentage'] },
        { 'Vitamin B12': ['Percentage'] },
        { 'Vitamin B6': ['Percentage'] },
    ],
    contains: [
        { 'Milk': ['IsOrContains'] },
        { 'Gluten Free': ['IsOrContains'] },
        { 'Wheat': ['IsOrContains'] },
        { 'Peanut': ['IsOrContains'] },
        { 'Tree Nut': ['IsOrContains'] },
        { 'Soy': ['IsOrContains'] },
        { 'Organic': ['IsOrContains'] }
    ]
};

// printAreas.js
// Static definitions of print areas for allowed products.
// Dimensions are still in cm for now; we’ll convert to px later.

export const PRINT_AREAS = {
  71: { // Bella+Canvas 3001 T-shirt
    front: {
      widthCm: 20 / 11.5,  // XS–M
      heightCm: 24 / 11.5,
      xCm: 1.7,
      yCm: 1,
    },
    back: {
      widthCm: 30.48 / 11,
      heightCm: 40.64 / 11,
      xCm: 2.7,
      yCm: 0.65,
    }
  },
  146: { // Unisex Hoodie
    front: {
      widthCm: 27.94 / 9,  // XS–M
      heightCm: 27.94 / 9,
      xCm: 2.55,
      yCm: 1.75,
    },
    back: {
      widthCm: 30.48 / 10.2,
      heightCm: 40.64 / 10.2,
      xCm: 2.6,
      yCm: 1.36,
    }
  },
  509: { // Men's Fitted
    front: {
      widthCm: 25.5 / 11.5,
      heightCm: 30 / 11.5,
      xCm: 1.45,
      yCm: 1,
    },
    back: {
      widthCm: 33 / 10.2,
      heightCm: 42 / 10.2,
      xCm: 2.5,
      yCm: 0.8,
    }
  }
};

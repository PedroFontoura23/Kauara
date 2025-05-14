document.addEventListener("DOMContentLoaded", async () => {
  // Initialize Firebase – adjust these values with your own configuration.
  var firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
  };
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const db = firebase.firestore();
  const auth = firebase.auth();

  // Global variables
  let productTemplates = [];
  let croppedDesignData = null; // To store the cropped image data URL
  let cropper = null;

  // DOM elements
  const designUpload = document.getElementById("designUpload");
  const designPreview = document.getElementById("designPreview");
  const cropModalElement = document.getElementById("cropModal");
  const cropModal = new bootstrap.Modal(cropModalElement);
  const cropImage = document.getElementById("cropImage");
  const cropSaveBtn = document.getElementById("cropSaveBtn");
  const productTemplateSelect = document.getElementById("productTemplate");
  const productPriceInput = document.getElementById("productPrice");

  // For testing, we hardcode the API key as requested.
  function getPrintfulKey() {
    // NOTE: In production, you should hide this key and call it from your server.
    return "4PxIrgbx9DXz4zfhsIysrhU4ut7aFFcU9fZGDcau";
  }

  // Fetch product templates from Printful and populate the dropdown.
  // We use a temporary CORS proxy to bypass the CORS restriction.
  async function fetchPrintfulTemplates() {
    const apiKey = getPrintfulKey();
    const proxyUrl = "https://cors-anywhere.herokuapp.com/";
    const apiUrl = "https://api.printful.com/products";
    try {
      const response = await fetch(proxyUrl + apiUrl, {
        method: "GET",
        headers: {
          "Authorization": `Basic ${btoa(apiKey + ":")}`,
          "Content-Type": "application/json"
        }
      });
      const text = await response.text();
      console.log("Raw response:", text);
      // Attempt to parse the response as JSON
      const data = JSON.parse(text);
      if (data && data.result) {
        productTemplates = data.result;
        populateTemplateDropdown();
      } else {
        console.error("No product templates returned:", data);
      }
    } catch (error) {
      console.error("Error fetching product templates:", error);
    }
  }

  function populateTemplateDropdown() {
    productTemplates.forEach((template) => {
      const option = document.createElement("option");
      option.value = template.id; // assuming each template has an "id" field
      option.textContent = template.name || ("Template " + template.id);
      // Optionally store a base price – if not provided, use a default value.
      option.dataset.basePrice = template.base_price || "20.00";
      productTemplateSelect.appendChild(option);
    });
  }

  // When a template is selected, calculate and display the product price.
  productTemplateSelect.addEventListener("change", () => {
    const selectedOption = productTemplateSelect.options[productTemplateSelect.selectedIndex];
    if (selectedOption && selectedOption.dataset.basePrice) {
      // For example, apply a 50% markup over the base price.
      const basePrice = parseFloat(selectedOption.dataset.basePrice);
      const retailPrice = (basePrice * 1.5).toFixed(2);
      productPriceInput.value = retailPrice;
    } else {
      productPriceInput.value = "";
    }
  });

  // Handle design file upload – open the cropping modal.
  designUpload.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        cropImage.src = e.target.result;
        cropModal.show();
        if (cropper) {
          cropper.destroy();
        }
        cropper = new Cropper(cropImage, {
          aspectRatio: 1,
          viewMode: 1,
          autoCropArea: 1,
          movable: true,
          rotatable: true
        });
      };
      reader.readAsDataURL(file);
    }
  });

  // When the user saves the crop, update the design preview.
  cropSaveBtn.addEventListener("click", () => {
    if (cropper) {
      const canvas = cropper.getCroppedCanvas({
        width: 500,
        height: 500
      });
      croppedDesignData = canvas.toDataURL("image/png");
      designPreview.src = croppedDesignData;
      designPreview.style.display = "block";
      cropModal.hide();
      cropper.destroy();
      cropper = null;
    }
  });

  // Function to create the product on Printful and then save it in Firestore.
  async function createAndUploadProduct(productData) {
    // productData should include: name, templateId, description, price, and designUrl.
    const apiKey = getPrintfulKey();
    // For demonstration, we assume a variant id equals the template id.
    // In a real implementation, you would likely choose the correct variant.
    const variantId = productData.templateId;
    const payload = {
      sync_product: {
        name: productData.name,
        external_id: "site_" + Date.now()
      },
      sync_variants: [
        {
          external_variant_id: variantId,
          retail_price: productData.price,
          files: [
            {
              type: "default",
              url: productData.designUrl // In production, this URL should be publicly accessible.
            }
          ]
        }
      ]
    };

    try {
      // Using the CORS proxy here as well for testing purposes.
      const proxyUrl = "https://cors-anywhere.herokuapp.com/";
      const response = await fetch(proxyUrl + "https://api.printful.com/store/products", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(apiKey + ":")}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (result && result.result) {
        // Save the product details to Firestore.
        await db.collection("products").add({
          printfulProductId: result.result.id,
          name: productData.name,
          description: productData.description,
          price: productData.price,
          templateId: productData.templateId,
          designUrl: productData.designUrl,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert("Product created successfully!");
        // Optionally, redirect the user or reset the form.
      } else {
        console.error("Error creating product on Printful:", result);
        alert("Failed to create product on Printful.");
      }
    } catch (error) {
      console.error("Error during product creation:", error);
      alert("Error creating product.");
    }
  }

  // Handle the form submission.
  const createProductForm = document.getElementById("createProductForm");
  createProductForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("productName").value.trim();
    const templateId = document.getElementById("productTemplate").value;
    const description = document.getElementById("productDescription").value.trim();
    const price = document.getElementById("productPrice").value.trim();

    if (!name || !templateId || !description || !price || !croppedDesignData) {
      alert("Please fill in all required fields and save your design.");
      return;
    }

    // IMPORTANT: In production, you will likely need to upload the croppedDesignData (a base64 data URL)
    // to a storage service (like Firebase Storage) to obtain a publicly accessible URL before sending it to Printful.
    const productData = {
      name,
      templateId,
      description,
      price,
      designUrl: croppedDesignData
    };

    await createAndUploadProduct(productData);
  });

  // Fetch the available templates when the page loads.
  fetchPrintfulTemplates();
});

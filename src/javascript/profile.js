document.addEventListener("DOMContentLoaded", function () {
  // Initialize Firebase
  const firebaseConfig = {
    apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
    authDomain: "kauara1.firebaseapp.com",
    projectId: "kauara1",
    storageBucket: "kauara1.firebasestorage.app",
    messagingSenderId: "651139031771",
    appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
    measurementId: "G-KL18R1CJ6S",
  };
  firebase.initializeApp(firebaseConfig);

  const auth = firebase.auth();
  const db = firebase.firestore();

  // Elements
  const userNameElement = document.getElementById("userName");
  const userEmailElement = document.getElementById("userEmail");
  const userBioElement = document.getElementById("userBio");
  const profilePictureElement = document.getElementById("profilePicture");
  const cropModal = new bootstrap.Modal(document.getElementById("cropModal"));
  const cropImage = document.getElementById("cropImage");
  const cropButton = document.getElementById("cropButton");
  const uploadPictureButton = document.getElementById("uploadPictureButton");
  // Post elements
  const addPostButton = document.getElementById("addPostButton");
  const postModal = new bootstrap.Modal(document.getElementById("postModal"));
  const postText = document.getElementById("postText");
  const postImageInput = document.getElementById("postImageInput");
  const postImagePreview = document.getElementById("postImagePreview");
  const submitPostButton = document.getElementById("submitPostButton");

  // Post image cropping elements
  const postCropModal = new bootstrap.Modal(document.getElementById("cropPostModal"));
  const postCropImage = document.getElementById("cropPostImage");
  const postCropButton = document.getElementById("cropPostButton")
  const MAX_IMAGE_SIZE_MB = 5; // Maximum file size in MB
  const MAX_DIMENSION = 1200; // Maximum width/height in pixels
  const JPEG_QUALITY = 0.7; // JPEG compression quality (0.0 to 1.0)
  

  let selectedImageFile = null;
  let cropper;
  let postCropper = null;

  // Add this event listener for the "Create Post" button
  addPostButton.addEventListener("click", () => {
    console.log("Create Post button clicked!"); // Debugging: Log to console
    postModal.show(); // Open the post creation modal
  });

  // Impedir que o dropdown feche ao clicar em "Conta" ou "Segurança"
  document.querySelectorAll('.dropdown-item[data-bs-toggle="collapse"]').forEach((button) => {
      button.addEventListener('click', (event) => {
          event.stopPropagation(); // Impede que o evento de clique se propague e feche o dropdown
      });
  });

  function initializePostManager(containerId) {
    return new PostManager(db, auth, containerId);
  }

  // Handle image upload and cropping
  postImageInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        const compressedImage = await compressImage(file);
        selectedImageFile = file;
        postCropImage.src = compressedImage;

        if (postCropper) {
          postCropper.destroy();
        }

        postCropModal.show();
        postCropper = new Cropper(postCropImage, {
          aspectRatio: NaN,
          viewMode: 1
        });
      } catch (error) {
        alert(error.message);
        postImageInput.value = ''; // Clear the input
        selectedImageFile = null;
      }
    }
  });

  // Handle image cropping
  postCropButton.addEventListener("click", () => {
    if (!postCropper) {
      alert("Please select an image first");
      return;
    }

    const canvas = postCropper.getCroppedCanvas();
    postImagePreview.src = canvas.toDataURL("image/jpeg");
    postImagePreview.classList.remove("d-none");
    postCropModal.hide();
  });

  // Handle post submission
  submitPostButton.addEventListener("click", async () => {
    const postContent = postText.value.trim();
    if (!postContent && !selectedImageFile) {
      alert("Please add text or an image.");
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert("User is not logged in.");
      return;
    }

    try {
      const firestoreUserId = await getUserIdFromUid(user.uid);
      let base64Image = null;

      if (selectedImageFile && postCropper) {
        const canvas = postCropper.getCroppedCanvas();
        base64Image = canvas.toDataURL("image/jpeg").split(",")[1];
      }

      await savePostToFirestore(postContent, base64Image, firestoreUserId);
    } catch (error) {
      console.error("Error handling post submission:", error);
      alert("Something went wrong.");
    }
  });

  // Function to save the post to Firestore
  async function savePostToFirestore(text, base64Image, userId) {
    console.log("UserID:", userId);
    if (!userId) {
      alert("User ID is missing.");
      return;
    }

    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists || !userDoc.data().artista) {
      alert("Only artists can create posts.");
      return;
    }

    if (!text && !base64Image) {
      alert("Please add some text or an image.");
      return;
    }

    const postText = text.trim() || "No content provided";

    try {
      await db.collection("posts").add({
        foreignUserId: userId,
        postText: postText,
        postImage: base64Image,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      postModal.hide();
      postText.value = "";
      postImageInput.value = "";
      postImagePreview.classList.add("d-none");
      selectedImageFile = null;

      if (postCropper) {
        postCropper.destroy();
        postCropper = null;
      }

      alert("Post successfully created!");
      displayPosts();
    } catch (error) {
      console.error("Error adding post:", error);
      alert("Failed to create post.");
    }
  }


  // Helper function to get user ID format (e.g., "user_1", "user_2")
  function getUserIdFromUid(uid) {
    return db
      .collection("users")
      .where("firebaseUID", "==", uid)
      .get()
      .then((querySnapshot) => {
        if (!querySnapshot.empty) {
          return querySnapshot.docs[0].id; // Return the user_(number)
        } else {
          throw new Error(`No user found for UID: ${uid}`);
        }
      });
  }

  // Check if user is logged in
  auth.onAuthStateChanged((user) => {
    if (user) {
      getUserIdFromUid(user.uid).then((firestoreUserId) => {
        console.log(`Logging in as: ${firestoreUserId}`);

        // Get user document
        const userDocRef = db.collection("users").doc(firestoreUserId);

        // Get ratings for the user
        const ratingsQuery = db.collection("ratings").where("foreignUserId", "==", firestoreUserId);

        // Execute both queries in parallel
        Promise.all([userDocRef.get(), ratingsQuery.get()])
          .then(([userDoc, ratingsSnapshot]) => {
            // Handle user data
            if (userDoc.exists) {
              const userData = userDoc.data();

              // Check if the user is an artista
              if (userData.artista === false) {
                // Hide the "Create Post" button
                addPostButton.style.display = "none";
              } else {
                // Show the "Create Post" button
                addPostButton.style.display = "block";
                // Show #Artista# if the user is an artist
                const artistaBadge = document.getElementById("artistaBadge");
                if (userData.artista === true) {
                  artistaBadge.style.display = "inline";
                } else {
                  artistaBadge.style.display = "none";
                }
              }
              const ratingsQuery = db.collection("ratings").where("foreignUserId", "==", firestoreUserId);
                displayPosts();

              // Update the rest of the user data
              userNameElement.textContent = userData.user_Name || "No Name Available";
              userEmailElement.textContent = user.email;
              userBioElement.textContent = userData.user_Bio || "No Bio Available";

              if (userData.profilePicture) {
                profilePictureElement.src = `data:image/jpeg;base64,${userData.profilePicture}`;
              }

              // Handle ratings data
              const ratings = ratingsSnapshot.docs.map(doc => doc.data().ratingValue);
              const totalRatings = ratings.length;

              if (totalRatings > 0) {
                const averageRating = ratings.reduce((a, b) => a + b, 0) / totalRatings;
                document.getElementById("userRating").textContent =
                  `${averageRating.toFixed(1)} ⭐ (${totalRatings} ratings)`;
              } else {
                document.getElementById("userRating").textContent = "No ratings yet";
              }
            } else {
              console.error(`No user data found for UID: ${firestoreUserId}`);
              document.getElementById("userRating").textContent = "Error loading ratings";
            }
          })
          .catch((error) => {
            console.error("Error fetching user data:", error);
            if (error.code === 'permission-denied') {
              alert("You don't have permission to access this profile.");
              window.location.href = "kauara.html";
            } else {
              alert("An error occurred while loading the profile.");
            }
          });
      })
      .catch((error) => {
        console.error("Error getting user ID:", error);
        alert("Error loading user data");
        window.location.href = "kauara.html";
      });
    } else {
      // User is not logged in, redirect to main page
      window.location.href = "kauara.html";
    }
  });
  //Limitador de tamanho da imagem
  async function compressImage(imageFile) {
    // Check file size first
    const fileSizeMB = imageFile.size / (1024 * 1024);
    if (fileSizeMB > MAX_IMAGE_SIZE_MB) {
      throw new Error(`Image size must be less than ${MAX_IMAGE_SIZE_MB}MB`);
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // Calculate new dimensions while maintaining aspect ratio
          let width = img.width;
          let height = img.height;
          
          if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            if (width > height) {
              height = (height / width) * MAX_DIMENSION;
              width = MAX_DIMENSION;
            } else {
              width = (width / height) * MAX_DIMENSION;
              height = MAX_DIMENSION;
            }
          }

          // Create canvas for compression
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          // Draw and compress
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          // Convert to base64 with quality setting
          const compressedBase64 = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          
          // Check final size
          const finalSize = (compressedBase64.length * 3) / 4 / (1024 * 1024);
          if (finalSize > MAX_IMAGE_SIZE_MB) {
            reject(new Error(`Compressed image is still too large (${finalSize.toFixed(2)}MB)`));
          } else {
            resolve(compressedBase64);
          }
        };
        img.onerror = reject;
        img.src = event.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });
  }

  // Edit Name Functionality
  document.getElementById("editNameButton").addEventListener("click", () => {
    const nameEditSection = document.getElementById("nameEditSection");
    nameEditSection.style.display = "block";
    const nameInput = document.getElementById("nameInput");
    nameInput.value = userNameElement.textContent; // Set the current name in the input
  });

  document.getElementById("saveNameButton").addEventListener("click", () => {
    const newName = document.getElementById("nameInput").value.trim();
    const user = auth.currentUser;

    getUserIdFromUid(user.uid).then((firestoreUserId) => {
      db.collection("users")
        .doc(firestoreUserId)
        .update({ user_Name: newName })
        .then(() => {
          userNameElement.textContent = newName; // Update the displayed name
          document.getElementById("nameEditSection").style.display = "none"; // Hide the edit section
        })
        .catch((error) => {
          console.error("Error updating name:", error);
          alert("Failed to update name.");
        });
    });
  });

  document.getElementById("cancelNameButton").addEventListener("click", () => {
    document.getElementById("nameEditSection").style.display = "none"; // Hide the edit section
  });

  // Edit Bio Functionality
  document.getElementById("editBioButton").addEventListener("click", () => {
    const bioEditSection = document.getElementById("bioEditSection");
    bioEditSection.style.display = "block";
    const bioInput = document.getElementById("bioInput");
    bioInput.value = userBioElement.textContent; // Set the current bio in the input
  });

  document.getElementById("saveBioButton").addEventListener("click", () => {
    const newBio = document.getElementById("bioInput").value.trim();
    const user = auth.currentUser;

    getUserIdFromUid(user.uid).then((firestoreUserId) => {
      db.collection("users")
        .doc(firestoreUserId)
        .update({ user_Bio: newBio })
        .then(() => {
          userBioElement.textContent = newBio; // Update the displayed bio
          document.getElementById("bioEditSection").style.display = "none"; // Hide the edit section
        })
        .catch((error) => {
          console.error("Error updating bio:", error);
          alert("Failed to update bio.");
        });
    });
  });

  document.getElementById("cancelBioButton").addEventListener("click", () => {
    document.getElementById("bioEditSection").style.display = "none"; // Hide the edit section
  });

  // File upload and cropping
  uploadPictureButton.addEventListener("click", () => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (file) {
        try {
          const compressedImage = await compressImage(file);
          cropImage.src = compressedImage;
          cropModal.show();
          cropper = new Cropper(cropImage, {
            aspectRatio: 1,
            viewMode: 1,
          });
        } catch (error) {
          alert(error.message);
        }
      }
    });
    fileInput.click();
  });

  // Save cropped image to Firestore as Base64
  cropButton.addEventListener("click", () => {
    const canvas = cropper.getCroppedCanvas({
      width: 300,
      height: 300,
    });

    if (!cropper) {
      console.error("Cropper is not initialized.");
      alert("Please select and crop an image first.");
      return;
    }

    canvas.toBlob((blob) => {
      const base64Image = canvas.toDataURL("image/jpeg").split(",")[1];
      const user = auth.currentUser;

      getUserIdFromUid(user.uid).then((firestoreUserId) => {
        db.collection("users")
          .doc(firestoreUserId)
          .update({ profilePicture: base64Image })
          .then(() => {
            profilePictureElement.src = `data:image/jpeg;base64,${base64Image}`;
            cropModal.hide();
            cropper.destroy();
          })
          .catch((error) => {
            console.error("Error updating profile picture:", error);
            alert("Error updating profile picture.");
          });
      });
    }, "image/jpeg");
  });

  // Log Out Functionality
  document.getElementById('logoutButton').addEventListener('click', () => {
    auth.signOut().then(() => {
      window.location.href = "kauara.html"; // Redirect to login page
    }).catch((error) => {
      console.error("Error during log out: ", error);
      alert("Failed to log out.");
    });
  });


  //delete account
  document.getElementById("deleteAccountButton").addEventListener("click", () => {
    const user = auth.currentUser;

    if (!user) {
      alert("No user is logged in.");
      return;
    }

    // Confirm the deletion with the user before proceeding
    if (confirm("Are you sure you want to delete your account and all associated data? This action is irreversible.")) {
      deleteUserAccountAndPosts(user);
    }
  });

  // Adicionar event listener ao botão de Dados Financeiros
  document.querySelector('[data-bs-target="#dadosFinanceirosModal"]').addEventListener("click", async () => {
    const user = auth.currentUser;
    if (!user) {
      console.log("Carregando dados financeiros.");
      return;
    }

    try {
      const firestoreUserId = await getUserIdFromUid(user.uid);
      const doc = await db.collection("dados_fiscais").doc(firestoreUserId).get();

      if (doc.exists) {
        const encryptedData = doc.data().encryptedData;
        const secretKey = "CH4v3_$UP3R_$3CR3T4_2"; // Use a mesma chave usada para criptografar
        const financialData = decryptData(encryptedData, secretKey);

        // Preencher o formulário com os dados descriptografados
        document.getElementById("fullName").value = financialData.fullName;
        document.getElementById("cpfCnpj").value = financialData.cpfCnpj;
        document.getElementById("phone").value = financialData.phone;
        document.getElementById("email").value = financialData.email;
        document.getElementById("address1").value = financialData.address1;
        document.getElementById("address2").value = financialData.address2;
        document.getElementById("city").value = financialData.city;
        document.getElementById("state").value = financialData.state;
        document.getElementById("zip").value = financialData.zip;
      } else {
        console.log("Nenhum dado financeiro encontrado.");
        // Limpar o formulário se não houver dados
        document.getElementById("financialDataForm").reset();
      }
    } catch (error) {
      console.error("Erro ao carregar dados financeiros:", error);
      console.log("Carregando dados financeiros.");
    }
  });

  // Função para criptografar dados
  function encryptData(data, secretKey) {
    return CryptoJS.AES.encrypt(JSON.stringify(data), secretKey).toString();
  }

  // Função para descriptografar dados
  function decryptData(encryptedData, secretKey) {
    const bytes = CryptoJS.AES.decrypt(encryptedData, secretKey);
    return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
  }

  // Função para validar CPF
  function validateCPF(cpf) {
    return cpf.isValid(cpf); // Usando a biblioteca cpf-cnpj-validator
  }

  // Função para validar nome
  function validateName(name) {
    const regex = /^[A-Za-zÀ-ú\s']+$/;
    return regex.test(name) && name.length >= 3;
  }

  // Função para validar endereço
  function validateAddress(address) {
    return address.length >= 5;
  }

  // Função para buscar CEP e preencher endereço
  document.getElementById("zip").addEventListener("blur", async () => {
    const cep = document.getElementById("zip").value.trim();

    if (cep.length === 8) {
      try {
        const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        const data = await response.json();

        if (!data.erro) {
          document.getElementById("address1").value = data.logradouro;
          document.getElementById("address2").value = data.complemento;
          document.getElementById("city").value = data.localidade;
          document.getElementById("state").value = data.uf;
        } else {
          alert("CEP não encontrado.");
        }
      } catch (error) {
        console.error("Erro ao buscar CEP:", error);
        alert("Erro ao buscar CEP.");
        }
    } else {
      alert("CEP inválido. O CEP deve ter 8 dígitos.");
    }
  });

 // Função para salvar os dados financeiros
  document.getElementById("financialDataForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    console.log("Formulário enviado!");

    try {
      // Verificar se o usuário está logado
      const user = auth.currentUser;
      if (!user) {
        alert("Usuário não está logado.");
        return;
      }

      // Coletar dados do formulário
      const financialData = {
        fullName: document.getElementById("fullName").value.trim(),
        cpfCnpj: document.getElementById("cpfCnpj").value.trim(),
        phone: document.getElementById("phone").value.trim(),
        email: document.getElementById("email").value.trim(),
        address1: document.getElementById("address1").value.trim(),
        address2: document.getElementById("address2").value.trim(),
        city: document.getElementById("city").value.trim(),
        state: document.getElementById("state").value.trim(),
        zip: document.getElementById("zip").value.trim()
      };

      // Validações básicas
      if (!financialData.fullName || !financialData.cpfCnpj || !financialData.email) {
        alert("Por favor, preencha todos os campos obrigatórios.");
        return;
      }

      // Obter o ID do usuário no Firestore
      const firestoreUserId = await getUserIdFromUid(user.uid);
      console.log("Firestore User ID:", firestoreUserId);

      // Criptografar os dados antes de salvar
      const secretKey = "CH4v3_$UP3R_$3CR3T4_2";
      const encryptedData = encryptData(financialData, secretKey);

      // Salvar os dados criptografados na coleção "dados_fiscais"
      await db.collection("dados_fiscais").doc(firestoreUserId).set({
        encryptedData: encryptedData,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      console.log("Dados salvos com sucesso!");
      alert("Dados financeiros salvos com sucesso!");
      
      // Fechar o modal após salvar
      const modal = bootstrap.Modal.getInstance(document.getElementById('dadosFinanceirosModal'));
      if (modal) {
        modal.hide();
      }

    } catch (error) {
      console.error("Erro ao salvar dados financeiros:", error);
      alert("Erro ao salvar dados financeiros: " + error.message);
    }
  });

  // Função para testar se os dados foram salvos
  async function testFinancialDataStorage(userId) {
    try {
      // Tenta recuperar o documento
      const docRef = await db.collection("dados_fiscais").doc(userId).get();
      
      if (docRef.exists) {
        console.log("Dados encontrados:", docRef.data());
        
        // Se os dados estiverem criptografados, tenta descriptografar
        const encryptedData = docRef.data().encryptedData;
        if (encryptedData) {
          const secretKey = "CH4v3_$UP3R_$3CR3T4_2";
          const decryptedData = decryptData(encryptedData, secretKey);
          console.log("Dados descriptografados:", decryptedData);
        }
        
        return true;
      } else {
        console.log("Nenhum dado encontrado para este usuário");
        return false;
      }
    } catch (error) {
      console.error("Erro ao verificar dados:", error);
      return false;
    }
  }

  // Uso:
  // Adicione este código após salvar os dados
  const user = auth.currentUser;
  if (user) {
    getUserIdFromUid(user.uid).then(firestoreUserId => {
      testFinancialDataStorage(firestoreUserId).then(exists => {
        if (exists) {
          console.log("Dados foram salvos com sucesso!");
        } else {
          console.log("Dados não foram salvos!");
        }
      });
    });
  }

  document.getElementById("financialDataForm").addEventListener("submit", (event) => {
      event.preventDefault();
      console.log("Formulário submetido!");
  });

  // 2. Adicione também um listener direto no botão
  document.querySelector('#financialDataForm button[type="submit"]').addEventListener("click", (event) => {
      console.log("Botão clicado!");
  });

  // Carregar dados ao abrir a página
  async function loadFinancialData() {
    const user = auth.currentUser;
    if (!user) {
      console.log("Carregando dados financeiros.");
      return;
    }

    try {
      const firestoreUserId = await getUserIdFromUid(user.uid);
      const doc = await db.collection("dados_fiscais").doc(firestoreUserId).get();

      if (doc.exists) {
        const encryptedData = doc.data().encryptedData;
        const secretKey = "CH4v3_$UP3R_$3CR3T4_2"; // Use a mesma chave usada para criptografar
        const financialData = decryptData(encryptedData, secretKey);

        // Preencher o formulário com os dados descriptografados
        document.getElementById("fullName").value = financialData.fullName;
        document.getElementById("cpfCnpj").value = financialData.cpfCnpj;
        document.getElementById("phone").value = financialData.phone;
        document.getElementById("email").value = financialData.email;
        document.getElementById("address1").value = financialData.address1;
        document.getElementById("address2").value = financialData.address2;
        document.getElementById("city").value = financialData.city;
        document.getElementById("state").value = financialData.state;
        document.getElementById("zip").value = financialData.zip;
      } else {
        console.log("Nenhum dado financeiro encontrado.");
        // Limpar o formulário se não houver dados
        document.getElementById("financialDataForm").reset();
      }
    } catch (error) {
      console.error("Erro ao carregar dados financeiros:", error);
    }
  }



  // Adicionar event listener ao botão de Dados Financeiros após o usuário carregar
  auth.onAuthStateChanged((user) => {
    if (user) {
      // Usuário está logado, adicionar event listener ao botão
      document.querySelector('[data-bs-target="#dadosFinanceirosModal"]').addEventListener("click", loadFinancialData);
    } else {
      // Usuário não está logado, redirecionar ou mostrar mensagem
      alert("Usuário não está logado.");
      window.location.href = "kauara.html"; // Redirecionar para a página de login
    }
  });

  auth.onAuthStateChanged((user) => {
    if (user) {
      db.collection("users").doc(user.uid).get().then((doc) => {
        if (doc.exists && doc.data().artista === true) {
          addPostButton.style.display = "block"; // Show the button
        } else {
          addPostButton.style.display = "none"; // Hide the button
        }
      });
    }
  });

  window.addEventListener("load", loadFinancialData);

  // Function to delete the user account and all their posts, comments, and financial data
  async function deleteUserAccountAndPosts(user) {
      try {
          // Get the user's Firestore ID
          const firestoreUserId = await getUserIdFromUid(user.uid);

          // Step 1: Fetch all posts made by the user
          const postsQuery = db.collection("posts").where("foreignUserId", "==", firestoreUserId);
          const postsSnapshot = await postsQuery.get();

          // Step 2: Delete all comments on the user's posts
          const deleteCommentPromises = [];
          postsSnapshot.forEach((postDoc) => {
              const postId = postDoc.id;

              // Fetch all comments on this post
              const commentsQuery = db.collection("comments").where("foreignPostId", "==", postId);
              deleteCommentPromises.push(
                  commentsQuery.get().then((commentsSnapshot) => {
                      const deleteComments = commentsSnapshot.docs.map((commentDoc) => commentDoc.ref.delete());
                      return Promise.all(deleteComments);
                  })
              );
          });

          // Step 3: Delete all comments made by the user
          const userCommentsQuery = db.collection("comments").where("foreignUserId", "==", firestoreUserId);
          deleteCommentPromises.push(
              userCommentsQuery.get().then((commentsSnapshot) => {
                  const deleteUserComments = commentsSnapshot.docs.map((commentDoc) => commentDoc.ref.delete());
                  return Promise.all(deleteUserComments);
              })
          );

          // Step 4: Delete all posts made by the user
          const deletePostPromises = postsSnapshot.docs.map((doc) => doc.ref.delete());

          // Step 5: Delete financial data of the user
          const financialDataRef = db.collection("dados_fiscais").doc(firestoreUserId);
          const deleteFinancialDataPromise = financialDataRef.delete();

          // Step 6: Delete the user's profile and contact documents
          const userDocRef = db.collection("users").doc(firestoreUserId);
          const contactDocRef = db.collection("contact").doc(firestoreUserId.replace('user', 'contact'));

          await Promise.all([
              ...deleteCommentPromises,
              ...deletePostPromises,
              deleteFinancialDataPromise,  // Delete financial data
              userDocRef.delete(),
              contactDocRef.delete()
          ]);

          // Step 7: Delete the user's authentication
          await user.delete();

          // Step 8: Log out and redirect
          auth.signOut().then(() => {
              window.location.href = "kauara.html"; // Redirect to login page
          }).catch((error) => {
              console.error("Error during log out: ", error);
              alert("Failed to log out.");
          });

          // Notify the user and redirect
          alert("Your account and all associated data have been deleted.");
          window.location.href = "kauara.html"; // Redirect to login page
      } catch (error) {
          console.error("Error during account deletion:", error);
          alert("Failed to delete account and associated data.");
      }
  }


  // Helper function to format timestamp as a readable date (e.g., "January 21, 2025, 5:00 PM")
  function formatTimestamp(date) {
      const options = { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: true 
      };
      return date.toLocaleString('en-US', options); // Format using the user's local settings
  }

  function displayPosts() {
      const user = auth.currentUser;

      if (!user) {
          console.error("No user is logged in.");
          return;
      }

      getUserIdFromUid(user.uid).then((firestoreUserId) => {
          const postManager = initializePostManager('allPostsContainer');
          // Always filter by the current user's ID on the profile page
          postManager.displayPosts(firestoreUserId, firestoreUserId);
      }).catch((error) => {
          console.error("Error fetching user ID:", error);
      });
  }
});
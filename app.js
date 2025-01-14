document.addEventListener("DOMContentLoaded", function () {
    // Firebase Initialization
    const firebaseConfig = {
        apiKey: "AIzaSyBcBmuXY9ulETrbn2PmzjsDZ7JKRcehqGo",
        authDomain: "kauara1.firebaseapp.com",
        projectId: "kauara1",
        storageBucket: "kauara1.firebasestorage.app",
        messagingSenderId: "651139031771",
        appId: "1:651139031771:web:8c73a3e1fff2d5cf2ae2fe",
        measurementId: "G-KL18R1CJ6S"
    };

    firebase.initializeApp(firebaseConfig);

    // Firebase Authentication and Firestore
    const auth = firebase.auth();
    const db = firebase.firestore();

    // Get references to the elements
    const profileButton = document.getElementById("profileButton");
    const authModal = document.getElementById("authModal");
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const loginEmail = document.getElementById("loginEmail");
    const loginPassword = document.getElementById("loginPassword");
    const registerEmail = document.getElementById("registerEmail");
    const registerPassword = document.getElementById("registerPassword");
    const registerName = document.getElementById("registerName");
    const loginSubmitButton = document.getElementById("loginSubmitButton");
    const registerSubmitButton = document.getElementById("registerSubmitButton");
    const showLoginButton = document.getElementById("showLogin");
    const showRegisterButton = document.getElementById("showRegister");
    const errorMessage = document.getElementById("errorMessage");
    const searchInput = document.getElementById("searchInput");
    const searchResultsContainer = document.getElementById("searchResultsContainer");

    // Show Login form when clicking "Log In"
    showLoginButton.addEventListener("click", () => {
        loginForm.style.display = "block";
        registerForm.style.display = "none";
        document.getElementById("modalTitle").textContent = "Login";
    });

    // Show Register form when clicking "Register"
    showRegisterButton.addEventListener("click", () => {
        registerForm.style.display = "block";
        loginForm.style.display = "none";
        document.getElementById("modalTitle").textContent = "Register";
    });

    // Show the modal when clicking the profile button (Login or Register)
    profileButton.addEventListener("click", () => {
        new bootstrap.Modal(authModal).show();
    });

    // Login logic
    loginSubmitButton.addEventListener("click", () => {
      const email = loginEmail.value.trim();
      const password = loginPassword.value.trim();

      auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
          const user = userCredential.user;

          // Verificar se o e-mail foi verificado
          if (!user.emailVerified) {
            alert("Seu e-mail ainda não foi verificado. Por favor, verifique sua caixa de entrada.");
            auth.signOut();
            return;
          }

          // Buscar dados na coleção `pendingUsers`
          db.collection("pendingUsers").doc(user.uid).get().then((doc) => {
            if (doc.exists) {
              const data = doc.data();

              // Transferir os dados para a coleção `users`
              db.collection("users").doc(user.uid).set({
                fullName: data.fullName,
                email: data.email,
                userId: data.userId,
                profilePicture: "default-profile.png",
                bio: "---",
              }).then(() => {
                console.log("Dados de usuário transferidos para a coleção final.");
                db.collection("pendingUsers").doc(user.uid).delete(); // Remover o registro temporário
                window.location.href = "profile.html"; // Redirecionar para o perfil
              });
            } else {
              console.error("Dados pendentes não encontrados.");
            }
          });
        })
        .catch((error) => {
          console.error("Erro ao fazer login:", error.message);
          displayErrorMessage("Erro ao fazer login. Verifique suas credenciais e tente novamente.");
        });
    });


    // Register logic
    registerSubmitButton.addEventListener("click", () => {
      const email = registerEmail.value.trim();
      const password = registerPassword.value.trim();
      const name = registerName.value.trim();

      if (!email || !password || !name) {
        displayErrorMessage("Todos os campos são obrigatórios.");
        return;
      }

      if (password.length < 6) {
        displayErrorMessage("A senha deve ter pelo menos 6 caracteres.");
        return;
      }

      auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
          const user = userCredential.user;
          const userId = generateRandomString(10); // Gerar ID único para o usuário

          // Salvar os dados temporários no Firestore
          db.collection("pendingUsers").doc(user.uid).set({
            fullName: name,
            email: email,
            userId: userId,
          })
          .then(() => {
            console.log("Dados de registro salvos com sucesso!");

            // Enviar e-mail de verificação
            user.sendEmailVerification()
              .then(() => {
                alert(`Um e-mail de verificação foi enviado para ${email}. Verifique sua caixa de entrada antes de fazer login.`);
                auth.signOut(); // Fazer logout automático
                window.location.href = "kauara.html"; // Redirecionar para a página principal
              })
              .catch((error) => {
                console.error("Erro ao enviar o e-mail de verificação:", error);
                alert("Erro ao enviar o e-mail de verificação. Tente novamente mais tarde.");
              });
          })
          .catch((error) => {
            console.error("Erro ao salvar os dados no Firestore:", error);
            alert("Erro ao salvar os dados do registro. Tente novamente.");
          });
        })
        .catch((error) => {
          console.error("Erro ao criar a conta:", error.message);
          if (error.code === "auth/email-already-in-use") {
            displayErrorMessage("Este e-mail já está em uso.");
          } else {
            displayErrorMessage(error.message);
          }
        });
    });

    // Função para gerar um ID aleatório
    function generateRandomString(length) {
      const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let result = "";
      for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      return result;
    }


    // Function to display error messages
    function displayErrorMessage(message) {
        errorMessage.textContent = message;
        errorMessage.style.display = "block";
    }

    // Check if the user is logged in when the page loads
    auth.onAuthStateChanged(user => {
        if (user) {
            profileButton.textContent = "Profile";
            profileButton.onclick = () => {
                window.location.href = "profile.html";
            };
        } else {
            profileButton.textContent = "Log In / Register";
        }
    });

    // Handle live search input (dropdown suggestions)
    searchInput.addEventListener("input", function () {
        const query = searchInput.value.trim();
        const lowercaseQuery = query.toLowerCase();

        if (query.length === 0) {
            searchResults.style.display = "none";
            searchResults.innerHTML = ""; // Clear results
            return;
        }

        // Query Firestore for matching users
        db.collection("users")
            .orderBy("fullName")
            .get()
            .then((snapshot) => {
                searchResults.innerHTML = ""; // Clear previous results

                // Filter results client-side for case-insensitive matching
                const matchingDocs = snapshot.docs.filter(doc => 
                    doc.data().fullName.toLowerCase().includes(lowercaseQuery)
                );

                if (matchingDocs.length > 0) {
                    matchingDocs.forEach((doc) => {
                        const userData = doc.data();

                        // Create a dropdown item
                        const listItem = document.createElement("li");
                        listItem.className = "dropdown-item";
                        listItem.textContent = userData.fullName || "No Name";

                        // Populate input with the selected name on click
                        listItem.addEventListener("click", () => {
                            searchInput.value = userData.fullName;
                            searchResults.style.display = "none"; // Hide the dropdown
                        });

                        searchResults.appendChild(listItem);
                    });

                    searchResults.style.display = "block"; // Show the dropdown
                } else {
                    const noResultsItem = document.createElement("li");
                    noResultsItem.className = "dropdown-item text-muted";
                    noResultsItem.textContent = "No results found";
                    searchResults.appendChild(noResultsItem);
                    searchResults.style.display = "block";
                }
            })
            .catch((error) => {
                console.error("Error searching users:", error);
            });
    });

    // Function to perform case-insensitive search
    function performSearch(query) {
        searchResultsContainer.innerHTML = ""; // Clear previous results
        
        // Convert query to lowercase for case-insensitive comparison
        const lowercaseQuery = query.toLowerCase();

        // Perform Firestore queries for fullName, email, or userId
        const usersRef = db.collection("users");
        
        // We'll use a custom startAt and endAt for case-insensitive search
        Promise.all([
            // Search by fullName
            usersRef
                .orderBy("fullName")
                .get()
                .then(snapshot => snapshot.docs.filter(doc => 
                    doc.data().fullName.toLowerCase().includes(lowercaseQuery)
                )),
            // Search by email
            usersRef
                .orderBy("email")
                .get()
                .then(snapshot => snapshot.docs.filter(doc => 
                    doc.data().email.toLowerCase().includes(lowercaseQuery)
                )),
            // Search by userId (exact match, case sensitive as IDs are unique)
            usersRef
                .where("userId", "==", query)
                .get()
        ]).then((results) => {
            let foundResults = false;
            
            // Combine and deduplicate results based on userId
            const processedIds = new Set();
            const combinedResults = results.flat().filter(doc => {
                if (doc.exists && !processedIds.has(doc.data().userId)) {
                    processedIds.add(doc.data().userId);
                    return true;
                }
                return false;
            });

            if (combinedResults.length > 0) {
                foundResults = true;
                combinedResults.forEach((doc) => {
                    const userData = doc.data();

                    // Create a preview container
                    const preview = document.createElement("div");
                    preview.className = "card mb-3";
                    preview.style.cursor = "pointer";

                    // Determine the profile picture URL or default
                    const profilePictureUrl = userData.profilePicture
                        ? `data:image/jpeg;base64,${userData.profilePicture}`
                        : "default-profile.png";

                    preview.innerHTML = `
                        <div class="row g-0 align-items-center">
                            <div class="col-2">
                                <img src="${profilePictureUrl}" class="img-fluid rounded-circle" alt="ProfilePicture" style="width: 50px; height: 50px;">
                            </div>
                            <div class="col-10">
                                <div class="card-body">
                                    <h5 class="card-title">${userData.fullName || "No Name Available"}</h5>
                                </div>
                            </div>
                        </div>
                    `;

                    // Redirect to the public profile page when clicked
                    preview.addEventListener("click", () => {
                        window.location.href = `public-profile.html?userId=${encodeURIComponent(userData.userId)}`;
                    });

                    searchResultsContainer.appendChild(preview);
                });
            }

            if (!foundResults) {
                searchResultsContainer.innerHTML = "<p>No results found.</p>";
            }
        }).catch((error) => {
            console.error("Error searching users:", error);
            searchResultsContainer.innerHTML = "<p>An error occurred. Please try again later.</p>";
        });
    }

    // Handle "Enter" keypress
    searchInput.addEventListener("keypress", function (event) {
        if (event.key === "Enter") {
            event.preventDefault(); // Prevent page reload
            const query = searchInput.value.trim();
            if (query) {
                performSearch(query); // Perform search
            }
        }
    });

    // Handle "Search" button click
    searchForm.addEventListener("submit", function (event) {
        event.preventDefault(); // Prevent form submission reload
        const query = searchInput.value.trim();
        if (query) {
            performSearch(query); // Perform search
        }
    });

    // Hide dropdown if user clicks outside
    document.addEventListener("click", (event) => {
        if (!searchInput.contains(event.target) && !searchResults.contains(event.target)) {
            searchResults.style.display = "none";
        }
    });
});
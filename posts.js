// Initialize posts display when DOM is loaded
document.addEventListener("DOMContentLoaded", function() {
  console.log("DOM Content Loaded - Starting posts initialization");
  
  const allPostsContainer = document.getElementById("allPostsContainer");
  if (!allPostsContainer) {
    console.error("Could not find allPostsContainer element");
    return;
  }
  
  // Check if Firebase is initialized
  if (!firebase.apps.length) {
    console.error("Firebase not initialized");
    return;
  }

  const db = firebase.firestore();
  console.log("Firestore instance created");

  function displayAllPosts() {
    console.log("Starting to fetch posts");
    // Clear existing posts
    allPostsContainer.innerHTML = "";

    // Get all posts, ordered by timestamp
    db.collection("posts")
      .orderBy("timestamp", "desc")
      .get()
      .then((querySnapshot) => {
        console.log(`Retrieved ${querySnapshot.size} posts from Firestore`);
        
        if (querySnapshot.empty) {
          console.log("No posts found in the collection");
          allPostsContainer.innerHTML = '<p class="text-muted">No posts yet!</p>';
          return [];
        }

        // Create array of promises for fetching user data
        const postPromises = querySnapshot.docs.map(async (doc) => {
          const postData = doc.data();
          console.log("Post data:", postData);
          console.log("Fetching user data for foreignUserId:", postData.foreignUserId);
          
          try {
            const userDoc = await db.collection("users")
              .doc(postData.foreignUserId)
              .get();
            
            if (!userDoc.exists) {
              console.error(`No user found for ID: ${postData.foreignUserId}`);
              return null;
            }

            const userData = userDoc.data();
            console.log("Found user data:", userData);
            
            return {
              postId: doc.id,
              ...postData,
              userName: userData.user_Name || "Unknown User",
              userProfilePic: userData.profilePicture || null
            };
          } catch (error) {
            console.error("Error fetching user data:", error);
            return null;
          }
        });

        // Resolve all promises and create post elements
        return Promise.all(postPromises);
      })
      .then((posts) => {
        console.log("Processing posts to display:", posts);
        // Filter out null posts (where user wasn't found)
        const validPosts = posts.filter(post => post !== null);
        console.log(`Found ${validPosts.length} valid posts to display`);
        
        if (validPosts.length === 0) {
          allPostsContainer.innerHTML = '<p class="text-muted">No posts available</p>';
          return;
        }

        validPosts.forEach(post => {
          const postElement = createPostElement(post);
          allPostsContainer.appendChild(postElement);
        });
        
        console.log("Finished displaying all posts");
      })
      .catch((error) => {
        console.error("Error in posts display process:", error);
        allPostsContainer.innerHTML = `
          <div class="alert alert-danger">
            Error loading posts. Please try again later.
            <br>
            Error details: ${error.message}
          </div>
        `;
      });
  }

  function createPostElement(post) {
    console.log("Creating element for post:", post);
    const postDiv = document.createElement("div");
    postDiv.className = "card mb-4";
    
    // Format timestamp
    const timestamp = post.timestamp?.toDate() || new Date();
    const formattedDate = timestamp.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Create post HTML structure
    postDiv.innerHTML = `
      <div class="card-header d-flex align-items-center">
        <img src="${post.userProfilePic ? `data:image/jpeg;base64,${post.userProfilePic}` : '/default-profile.jpg'}"
             class="rounded-circle me-2"
             alt="Profile Picture"
             style="width: 40px; height: 40px; object-fit: cover;">
        <div>
          <h6 class="mb-0">${post.userName}</h6>
          <small class="text-muted">${formattedDate}</small>
        </div>
      </div>
      <div class="card-body">
        <p class="card-text">${post.postText}</p>
        ${post.postImage ? `
          <img src="data:image/jpeg;base64,${post.postImage}"
               class="img-fluid rounded"
               alt="Post Image"
               style="max-height: 500px; width: auto;">
        ` : ''}
      </div>
    `;

    return postDiv;
  }

  // Initial load of posts
  console.log("Starting initial posts load");
  displayAllPosts();

  // Refresh posts periodically (every 30 seconds)
  setInterval(displayAllPosts, 30000);
});
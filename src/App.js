import React, { useState, useEffect, useCallback, useMemo } from 'react';

// --- Firebase Imports ---
// Using the v9 modular SDK for tree-shaking and performance
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, onSnapshot, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// --- App Configuration & Constants ---

// IMPORTANT: Replace this with your actual Firebase project configuration.
// This is obtained from the Firebase console (Project Settings > General > Your apps).
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "family-movie-night-app", // Should match your Firebase project ID
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase services ONCE and export for use in other potential files.
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const FAMILY_MEMBERS = {
    'Kate': { born: 1978, type: 'Adult' },
    'Ryan': { born: 1978, type: 'Adult' },
    'Ellie': { born: 2011, type: 'Kid' },
    'Quinn': { born: 2014, type: 'Kid' }
};
const CURRENT_YEAR = 2025;
const ERAS = ["Pre-80s Classics", "80s Throwbacks", "90s Gems", "2000s Hits", "Modern (2010+)"];
const INITIAL_GENRES = ["Comedy", "Action", "Sci-Fi", "Family", "Fantasy", "Animation", "Drama", "Adventure", "Thriller", "Musical"];
const INITIAL_MOODS = ["Need a good laugh", "A blast from the past", "Something for everyone", "Heartwarming story", "Mind-bending plot", "Edge of your seat", "Epic adventure", "Cozy movie night", "Critically-acclaimed", "Visually stunning"];
const SEED_FAVORITES = ["10 Things I Hate About You", "Clueless", "The Goonies", "The Breakfast Club", "Harry and the Hendersons", "Adventures in Babysitting", "High Fidelity"];

// --- Main App Component ---

export default function App() {
    // --- State Management ---
    const [authReady, setAuthReady] = useState(false);
    const [currentUser, setCurrentUser] = useState('Kate');
    const [movies, setMovies] = useState([]); // This is the permanent library
    const [recommendations, setRecommendations] = useState([]); // This is for temporary suggestions
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ eras: [], genres: [], moods: [] });
    const [dynamicGenres, setDynamicGenres] = useState(INITIAL_GENRES);
    const [selectedMovie, setSelectedMovie] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatingMessage, setGeneratingMessage] = useState('');
    const [error, setError] = useState(null);

    // --- Authentication ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, user => {
            if (user) {
                setAuthReady(true); // User is authenticated, we can now fetch data.
            } else {
                // No user found, sign them in anonymously for a persistent session.
                signInAnonymously(auth).catch(err => {
                    console.error("Anonymous sign-in failed:", err);
                    setError("Could not authenticate with the service. Please refresh the page.");
                });
            }
        });
        return () => unsubscribe(); // Cleanup on unmount
    }, []);

    // --- Firebase Data Fetching ---
    useEffect(() => {
        // Guard clause: Do not fetch data until authentication is confirmed.
        if (!authReady) return;

        const moviesCollectionRef = collection(db, "movies");
        const unsubscribe = onSnapshot(moviesCollectionRef, (snapshot) => {
            const moviesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMovies(moviesData);
            setIsLoading(false);
        }, (err) => {
            console.error("Firestore snapshot error:", err);
            setError("Could not connect to the movie database. Check your Firebase config and security rules.");
            setIsLoading(false);
        });

        return () => unsubscribe(); // Cleanup Firestore listener on unmount
    }, [authReady]); // This effect depends on the user's auth state.

    // --- Memoized Calculations for Performance ---
    const filteredMovies = useMemo(() => {
        // This filters the permanent library, not the recommendations
        if (!searchTerm && filters.eras.length === 0) {
            return movies; // Return all movies if no filters are active
        }
        return movies.filter(movie => {
            const titleMatch = movie.title.toLowerCase().includes(searchTerm.toLowerCase());
            const eraMatch = filters.eras.length === 0 || filters.eras.some(era => {
                const year = movie.year;
                if (era === "Pre-80s Classics") return year < 1980;
                if (era === "80s Throwbacks") return year >= 1980 && year < 1990;
                if (era === "90s Gems") return year >= 1990 && year < 2000;
                if (era === "2000s Hits") return year >= 2000 && year < 2010;
                if (era === "Modern (2010+)") return year >= 2010;
                return false;
            });
            return titleMatch && eraMatch;
        });
    }, [movies, searchTerm, filters.eras]);
    
    // --- API & Database Handlers ---

    const callGeminiAPI = async (prompt, schema) => {
        // This is a placeholder for your secure backend call.
        // In a real app, this function would fetch from your own server endpoint,
        // which then adds the API key and calls Google.
        const apiKey = ""; // Left empty as per instruction.
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema,
            }
        };

        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errorBody = await response.json();
                throw new Error(errorBody.error?.message || 'API request failed');
            }
            const result = await response.json();
            return JSON.parse(result.candidates[0].content.parts[0].text);
        } catch (err) {
            console.error("Gemini API call failed:", err);
            setError(`The suggestion service failed: ${err.message}. Please try again later.`);
            return null;
        }
    };

    const handleRating = useCallback(async (movieId, rating) => {
        const movieRef = doc(db, "movies", movieId);
        try {
            // Use dot notation to update a specific field in a map
            await setDoc(movieRef, { ratings: { [currentUser]: rating } }, { merge: true });
        } catch (err) {
            console.error("Error setting rating:", err);
            setError("Failed to save your rating.");
        }
    }, [currentUser]);
    
    const handleReview = useCallback(async (movieId, reviewText) => {
         const movieRef = doc(db, "movies", movieId);
         try {
            await setDoc(movieRef, { reviews: { [currentUser]: reviewText } }, { merge: true });
         } catch (err) {
            console.error("Error saving review:", err);
            setError("Failed to save your review.");
         }
    }, [currentUser]);
    
    const handleLastWatched = useCallback(async (movieId, watched) => {
        const movieRef = doc(db, "movies", movieId);
        let timestamp = new Date();
        if (watched === "A While Ago (~3yr)") timestamp.setFullYear(timestamp.getFullYear() - 3);
        else if (watched === "A Long Time Ago (>5yr)") timestamp.setFullYear(timestamp.getFullYear() - 5);
        
        try {
            await setDoc(movieRef, { lastWatched: timestamp }, { merge: true });
        } catch (err) {
            console.error("Error setting last watched date:", err);
            setError("Failed to save the watch date.");
        }
    }, []);

    const handleSeedDatabase = useCallback(async () => {
        setIsGenerating(true);
        setGeneratingMessage('Generating initial movie list...');
        setError(null);

        const prompt = `Generate a list of 50 diverse, family-appropriate movies inspired by these favorites: ${SEED_FAVORITES.join(', ')}.`;
        const schema = {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING" },
                    year: { type: "INTEGER" }
                },
                required: ["title", "year"]
            }
        };

        const generatedMovies = await callGeminiAPI(prompt, schema);

        if (generatedMovies) {
            try {
                setGeneratingMessage('Saving movies to your library...');
                const batch = writeBatch(db);
                generatedMovies.forEach(movie => {
                    const docRef = doc(collection(db, "movies"));
                    const posterUrl = `https://placehold.co/500x750/171717/FFFFFF?text=${encodeURIComponent(movie.title)}`;
                    batch.set(docRef, {
                        ...movie,
                        posterUrl,
                        ratings: {},
                        reviews: {},
                        createdAt: serverTimestamp(),
                    });
                });
                await batch.commit();
            } catch (err) {
                console.error("Error writing seeded movies to Firestore:", err);
                setError("Could not save the generated movies to the database.");
            }
        }
        setIsGenerating(false);
        setGeneratingMessage('');
    }, []);

    const handleGenerateSuggestions = useCallback(async (baseMovie = null) => {
        setIsGenerating(true);
        setGeneratingMessage(baseMovie ? `Finding movies like ${baseMovie.title}...` : 'Generating new suggestions...');
        setRecommendations([]);
        setError(null);

        const familyProfile = Object.entries(FAMILY_MEMBERS).map(([name, data]) => `${name} (age ${CURRENT_YEAR - data.born})`).join(', ');
        const ratedMovies = movies.filter(m => m.ratings && Object.keys(m.ratings).length > 0)
                                  .map(m => `Title: ${m.title}, Family Avg Rating: ${calculateFamilyAverage(m.ratings)}/5`)
                                  .slice(0, 20)
                                  .join('; ');
        
        const existingLibrary = movies.map(m => m.title).join(', ');

        let prompt = `Act as a movie recommender for this family: ${familyProfile}. Their rating history is: ${ratedMovies || 'None yet'}. Exclude these from suggestions as they are already in the library: ${existingLibrary}.`;

        if (baseMovie) {
             prompt += ` Generate 10 new movie suggestions very similar to "${baseMovie.title}".`;
        } else {
             prompt += ` Generate 10 new movie suggestions based on their profile, ratings, and these filters: Eras: ${filters.eras.join(', ') || 'Any'}; Genres: ${filters.genres.join(', ') || 'Any'}; Moods: ${filters.moods.join(', ') || 'Any'}. Find novel recommendations.`;
        }
        
        const schema = {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING" },
                    year: { type: "INTEGER" }
                },
                required: ["title", "year"]
            }
        };

        const suggestions = await callGeminiAPI(prompt, schema);
        if (suggestions) {
            const suggestionsWithData = suggestions.map(s => ({
                ...s,
                id: `rec-${s.title.replace(/\s/g, '')}`, // Temp unique ID for React key
                posterUrl: `https://placehold.co/500x750/171717/FFFFFF?text=${encodeURIComponent(s.title)}`,
                isSuggestion: true, // Flag to differentiate from library movies
            }));
            setRecommendations(suggestionsWithData);
        }
        
        setIsGenerating(false);
        setGeneratingMessage('');
    }, [movies, filters]);

    const handleRefreshGenres = useCallback(async () => {
        setIsGenerating(true);
        setGeneratingMessage('Creating new genres...');
        setError(null);
        
        const highRatedMovies = movies.filter(m => m.ratings && calculateFamilyAverage(m.ratings) >= 4)
                                      .map(m => m.title).slice(0, 10).join(', ');

        if (!highRatedMovies) {
            setError("Please rate some movies 4 stars or higher to generate creative genres.");
            setIsGenerating(false);
            setGeneratingMessage('');
            return;
        }

        const prompt = `Based on these highly-rated movies (${highRatedMovies}), generate 10 blended, creative genre categories. Examples: "Quirky Coming-of-Age", "Sci-Fi with a Heart". Do not use standard single-word genres.`;
        const schema = { type: "ARRAY", items: { type: "STRING" } };
        
        const newGenres = await callGeminiAPI(prompt, schema);
        if (newGenres) {
            setDynamicGenres([...INITIAL_GENRES, ...newGenres]);
        }
        setIsGenerating(false);
        setGeneratingMessage('');
    }, [movies]);


    // --- Render Logic ---
    if (!authReady) {
        return <LoadingScreen message="Authenticating..." />;
    }

    return (
        <div className="bg-neutral-900 text-white min-h-screen font-sans">
            <div className="container mx-auto p-4 md:p-8">
                
                <header className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
                    <h1 className="text-4xl font-bold text-indigo-400">Family Movie Night</h1>
                    <UserSelector currentUser={currentUser} onUserChange={setCurrentUser} />
                </header>

                <div className="bg-neutral-800 p-6 rounded-lg mb-8 shadow-lg">
                    <SearchBar searchTerm={searchTerm} onSearch={setSearchTerm} />
                    <FilterPanel 
                        filters={filters}
                        onFilterChange={(type, value) => setFilters(prev => ({ ...prev, [type]: prev[type].includes(value) ? prev[type].filter(v => v !== value) : [...prev[type], value] }))}
                        dynamicGenres={dynamicGenres}
                        onRefreshGenres={handleRefreshGenres}
                        onGenerateSuggestions={() => handleGenerateSuggestions()}
                        isGenerating={isGenerating}
                    />
                </div>

                {error && <div className="bg-red-500/20 text-red-300 p-4 rounded-lg mb-8 transition-opacity duration-300">{error}</div>}
                
                {(isGenerating || recommendations.length > 0) && (
                    <section className="mb-12">
                         <h2 className="text-2xl font-semibold text-gray-300 mb-4">Suggestions for You</h2>
                         {isGenerating && recommendations.length === 0 
                            ? <LoadingScreen message={generatingMessage} />
                            : <MovieGrid movies={recommendations} onMovieSelect={setSelectedMovie} onMoreLikeThis={handleGenerateSuggestions} />
                         }
                    </section>
                )}

                <main>
                    <h2 className="text-2xl font-semibold text-gray-300 mb-4">Your Movie Library</h2>
                    {isLoading ? <LoadingScreen message="Loading your movie library..." /> : (
                        movies.length === 0 ? (
                            <div className="text-center py-16 bg-neutral-800/50 rounded-lg">
                                <h2 className="text-2xl font-semibold text-gray-400 mb-4">Your library is empty!</h2>
                                <p className="text-gray-500 mb-6">Seed your database with some classics to get started.</p>
                                <button
                                    onClick={handleSeedDatabase}
                                    disabled={isGenerating}
                                    className="bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-800 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 shadow-lg"
                                >
                                    {isGenerating ? generatingMessage : 'Seed Our Database'}
                                </button>
                            </div>
                        ) : (
                           <MovieGrid movies={filteredMovies} onMovieSelect={setSelectedMovie} onMoreLikeThis={handleGenerateSuggestions} />
                        )
                    )}
                </main>
            </div>
            
            {selectedMovie && (
                <MovieModal
                    movie={selectedMovie}
                    onClose={() => setSelectedMovie(null)}
                    currentUser={currentUser}
                    onRate={handleRating}
                    onReview={handleReview}
                    onLastWatched={handleLastWatched}
                />
            )}
        </div>
    );
}

// --- Sub-Components ---

const UserSelector = ({ currentUser, onUserChange }) => (
    <div className="flex space-x-2 bg-neutral-800 p-2 rounded-lg">
        {Object.keys(FAMILY_MEMBERS).map(user => (
            <button key={user} onClick={() => onUserChange(user)} className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-200 ${currentUser === user ? 'bg-indigo-500 text-white' : 'bg-neutral-700 hover:bg-neutral-600 text-gray-300'}`}>
                {user}
            </button>
        ))}
    </div>
);

const SearchBar = ({ searchTerm, onSearch }) => (
    <div className="mb-6">
        <input type="text" placeholder="Search your rated movies..." value={searchTerm} onChange={(e) => onSearch(e.target.value)} className="w-full bg-neutral-700 border border-neutral-600 rounded-lg py-3 px-4 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"/>
    </div>
);

const FilterPanel = ({ filters, onFilterChange, dynamicGenres, onRefreshGenres, onGenerateSuggestions, isGenerating }) => {
    const FilterButton = ({ type, value }) => (
        <button onClick={() => onFilterChange(type, value)} className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 border-2 ${filters[type].includes(value) ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-neutral-700 border-neutral-600 hover:border-indigo-500 text-gray-300'}`}>
            {value}
        </button>
    );

    return (
        <div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                    <h4 className="font-semibold mb-3 text-gray-400">Eras</h4>
                    <div className="flex flex-wrap gap-2">{ERAS.map(era => <FilterButton key={era} type="eras" value={era} />)}</div>
                </div>
                <div>
                    <h4 className="font-semibold mb-3 text-gray-400 flex justify-between items-center">
                        <span>Genres</span>
                        <button onClick={onRefreshGenres} disabled={isGenerating} className="text-xs text-indigo-400 hover:text-indigo-300 disabled:text-gray-500 disabled:cursor-not-allowed">Refresh</button>
                    </h4>
                    <div className="flex flex-wrap gap-2">{dynamicGenres.slice(0, 15).map(genre => <FilterButton key={genre} type="genres" value={genre} />)}</div>
                </div>
                <div>
                    <h4 className="font-semibold mb-3 text-gray-400">Moods</h4>
                    <div className="flex flex-wrap gap-2">{INITIAL_MOODS.map(mood => <FilterButton key={mood} type="moods" value={mood} />)}</div>
                </div>
            </div>
            <div className="mt-6 text-center">
                <button onClick={onGenerateSuggestions} disabled={isGenerating} className="w-full md:w-auto bg-green-500 hover:bg-green-600 disabled:bg-green-800 disabled:cursor-not-allowed text-white font-bold py-3 px-8 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg">
                    {isGenerating ? 'Generating...' : 'Generate Suggestions'}
                </button>
            </div>
        </div>
    );
};

const MovieGrid = ({ movies, onMovieSelect, onMoreLikeThis }) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
        {movies.map(movie => <MovieCard key={movie.id} movie={movie} onMovieSelect={onMovieSelect} onMoreLikeThis={onMoreLikeThis} />)}
    </div>
);

const MovieCard = ({ movie, onMovieSelect, onMoreLikeThis }) => {
    const familyAvg = useMemo(() => calculateFamilyAverage(movie.ratings), [movie.ratings]);
    const adultAvg = useMemo(() => calculateGroupAverage(movie.ratings, 'Adult'), [movie.ratings]);
    const kidAvg = useMemo(() => calculateGroupAverage(movie.ratings, 'Kid'), [movie.ratings]);

    const handleCardClick = (e) => {
        // Prevent modal from opening if the user clicks an interactive element inside the card.
        if (e.target.closest('.interactive-element')) return;
        onMovieSelect(movie);
    };
    
    return (
        <div className="bg-neutral-800 rounded-lg overflow-hidden shadow-lg transform hover:-translate-y-1.5 transition-transform duration-300 flex flex-col cursor-pointer group" onClick={handleCardClick}>
            <div className="relative pt-[150%]">
                <img src={movie.posterUrl} alt={movie.title} className="absolute top-0 left-0 w-full h-full object-cover" onError={(e) => { e.target.onerror = null; e.target.src=`https://placehold.co/500x750/171717/FFFFFF?text=${encodeURIComponent(movie.title)}`}} />
                {familyAvg > 0 && (
                    <div className="absolute top-2 right-2 bg-black/70 rounded-full flex items-center p-1.5 backdrop-blur-sm">
                        <StarIcon className="w-4 h-4 text-yellow-400" />
                        <span className="text-white font-bold text-sm ml-1">{familyAvg.toFixed(1)}</span>
                    </div>
                )}
            </div>
            <div className="p-3 flex flex-col flex-grow">
                 <h3 className="font-bold text-md text-gray-200 truncate" title={movie.title}>{movie.title}</h3>
                 <p className="text-xs text-gray-500">{movie.year}</p>
                 {!movie.isSuggestion && <div className="mt-3 space-y-2 text-xs">
                    <div><span className="font-semibold text-gray-400 w-12 inline-block">Adults:</span><StarRating rating={adultAvg} /></div>
                    <div><span className="font-semibold text-gray-400 w-12 inline-block">Kids:</span><StarRating rating={kidAvg} /></div>
                 </div>}
                 <div className="mt-auto pt-4 flex justify-between items-center">
                    <button onClick={() => onMoreLikeThis(movie)} className="interactive-element text-xs bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded hover:bg-indigo-500/40 transition-colors">More like this</button>
                    <div className="flex space-x-1.5 interactive-element">{['YouTube', 'Netflix', 'Prime Video'].map(p => <StreamIconLink key={p} platform={p} title={movie.title} />)}</div>
                 </div>
            </div>
        </div>
    );
};

const MovieModal = ({ movie, onClose, currentUser, onRate, onReview, onLastWatched }) => {
    const familyAvg = useMemo(() => calculateFamilyAverage(movie.ratings), [movie.ratings]);
    // For library movies, get rating from the DB. For suggestions, it's always 0 initially.
    const userRating = movie.isSuggestion ? 0 : movie.ratings?.[currentUser] || 0;
    const userReview = movie.isSuggestion ? '' : movie.reviews?.[currentUser] || '';
    const [reviewText, setReviewText] = useState(userReview);

    const handleReviewBlur = () => {
        if (reviewText !== userReview && !movie.isSuggestion) {
            onReview(movie.id, reviewText);
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-neutral-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-full overflow-y-auto flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
                <div className="w-full md:w-1/3 flex-shrink-0"><img src={movie.posterUrl} alt={movie.title} className="w-full h-auto object-cover rounded-t-lg md:rounded-l-lg md:rounded-tr-none" onError={(e) => { e.target.onerror = null; e.target.src=`https://placehold.co/500x750/171717/FFFFFF?text=${encodeURIComponent(movie.title)}`}}/></div>
                <div className="p-6 md:p-8 flex-grow">
                    <div className="flex justify-between items-start"><h2 className="text-3xl font-bold text-white">{movie.title}</h2><button onClick={onClose} className="text-4xl text-gray-400 hover:text-white leading-none">&times;</button></div>
                    <p className="text-lg text-gray-400 mb-4">{movie.year}</p>
                    {familyAvg > 0 && <div className="flex items-center my-4"><span className="text-lg font-semibold mr-2 text-gray-300">Family Average:</span><StarRating rating={familyAvg} /><span className="ml-2 text-yellow-400 font-bold">{familyAvg.toFixed(1)}</span></div>}
                    
                    {!movie.isSuggestion && (<>
                        <div className="bg-neutral-700/50 p-4 rounded-lg my-6">
                            <h4 className="font-semibold text-lg mb-3 text-indigo-300">Your Rating ({currentUser})</h4>
                            <div className="mb-4"><StarRating rating={userRating} onRate={(rating) => onRate(movie.id, rating)} interactive={true} size="lg"/></div>
                            <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} onBlur={handleReviewBlur} placeholder={`What did you think, ${currentUser}?`} className="w-full bg-neutral-900/50 border border-neutral-600 rounded-lg p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" rows="3"></textarea>
                        </div>
                        <div className="my-6">
                            <h4 className="font-semibold text-lg mb-3 text-gray-300">Last Watched</h4>
                            <div className="flex flex-wrap gap-2">{["Recent (<1yr)", "A While Ago (~3yr)", "A Long Time Ago (>5yr)"].map(val => <button key={val} onClick={() => onLastWatched(movie.id, val)} className="bg-neutral-700 hover:bg-neutral-600 text-gray-300 font-semibold py-2 px-4 rounded-lg transition-colors">{val}</button>)}</div>
                        </div>
                    </>)}
                    {movie.isSuggestion && <div className="p-4 my-6 bg-indigo-500/10 rounded-lg text-indigo-200">This is a new suggestion. Rate it after you watch to add it to your library!</div>}
                </div>
            </div>
        </div>
    );
};

const LoadingScreen = ({ message }) => (
    <div className="text-center py-16">
        <svg className="animate-spin h-10 w-10 text-indigo-400 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
        <p className="text-lg text-gray-400 animate-pulse">{message}</p>
    </div>
);

// --- SVG Icons & Utility Components ---
const StarRating = ({ rating, onRate = () => {}, interactive = false, size = 'md' }) => {
    const [hoverRating, setHoverRating] = useState(0);
    const starSize = { sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-8 h-8' }[size];
    return (
        <div className={`flex items-center ${interactive ? 'interactive-element' : ''}`}>
            {[1, 2, 3, 4, 5].map(star => <div key={star} className={`cursor-${interactive ? 'pointer' : 'default'} text-gray-500`} onMouseEnter={() => interactive && setHoverRating(star)} onMouseLeave={() => interactive && setHoverRating(0)} onClick={() => interactive && onRate(star)}><StarIcon className={`${starSize} transition-colors ${(hoverRating || rating) >= star ? 'text-yellow-400' : 'text-neutral-600'}`} /></div>)}
        </div>
    );
};

const StarIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}><path fillRule="evenodd" d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.007z" clipRule="evenodd" /></svg>);

const StreamIconLink = ({ platform, title }) => {
    const urls = {
        YouTube: `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`,
        Netflix: `https://www.netflix.com/search?q=${encodeURIComponent(title)}`,
        'Prime Video': `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${encodeURIComponent(title)}&ie=UTF8`,
    };
    return <a href={urls[platform]} target="_blank" rel="noopener noreferrer" className="opacity-60 hover:opacity-100 transition-opacity"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 17a24.12 24.12 0 0 1 0-10C2.5 6 7.5 4 12 4s9.5 2 9.5 3 0 10 0 10-4.5 2-9.5 2-9.5-2-9.5-3Z"/><path d="m10 15 5-3-5-3z"/></svg></a>
};

// --- Data Calculation Utilities ---
const calculateAverage = (ratings) => {
    if (!ratings || Object.keys(ratings).length === 0) return 0;
    const values = Object.values(ratings);
    return values.reduce((sum, val) => sum + val, 0) / values.length;
};

const calculateFamilyAverage = (ratings) => calculateAverage(ratings);

const calculateGroupAverage = (ratings, groupType) => {
    if (!ratings) return 0;
    const groupRatings = {};
    for (const user in ratings) {
        if (FAMILY_MEMBERS[user]?.type === groupType) {
            groupRatings[user] = ratings[user];
        }
    }
    return calculateAverage(groupRatings);
};

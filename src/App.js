import React, { useState, useEffect, useCallback, useMemo } from 'react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, onSnapshot, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// --- App Configuration & Constants ---

const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID
};

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
const INITIAL_MOODS = ["Need a good laugh", "A blast from the past", "Something for everyone", "Heartwarming story", "Mind-bending plot", "Edge of your seat", "Epic adventure", "Cozy movie night", "Critically-acclaimed", "Visually stunning"];
const SEED_FAVORITES = ["10 Things I Hate About You", "Clueless", "The Goonies", "The Breakfast Club", "Harry and the Hendersons", "Adventures in Babysitting", "High Fidelity"];

// --- Main App Component ---

export default function App() {
    // --- State Management ---
    const [authReady, setAuthReady] = useState(false);
    const [currentUser, setCurrentUser] = useState('Kate');
    const [movies, setMovies] = useState([]);
    const [recommendations, setRecommendations] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filters, setFilters] = useState({ eras: [], genres: [], moods: [] });
    const [dynamicGenres, setDynamicGenres] = useState([]);
    const [selectedMovie, setSelectedMovie] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatingMessage, setGeneratingMessage] = useState('');
    const [error, setError] = useState(null);

    // --- API & Database Handlers ---
    const callGeminiAPI = async (prompt, schema) => {
        const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
        if (!apiKey) {
            setError("API Key for the suggestion service is not configured.");
            return null;
        }
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schema } };

        try {
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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

    // --- Initial Data Loading Effects ---

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, user => {
            if (user) setAuthReady(true);
            else signInAnonymously(auth).catch(err => setError("Could not authenticate."));
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (!authReady) return;
        const unsubscribe = onSnapshot(collection(db, "movies"), snapshot => {
            setMovies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setIsLoading(false);
        }, err => {
            setError("Could not connect to the movie database.");
            setIsLoading(false);
        });
        return unsubscribe;
    }, [authReady]);

    // New effect to fetch initial genres from Gemini
    useEffect(() => {
        const fetchInitialGenres = async () => {
            setGeneratingMessage('Warming up the suggestion engine...');
            const prompt = `Generate a list of 15 diverse movie genres. Include classic genres like 'Comedy' and 'Sci-Fi', but also add several creative, blended genres like 'Quirky Coming-of-Age' or 'Heartfelt Sci-Fi Adventure'.`;
            const schema = { type: "ARRAY", items: { type: "STRING" } };
            const genres = await callGeminiAPI(prompt, schema);
            if (genres) {
                setDynamicGenres(genres);
            } else {
                setDynamicGenres(["Comedy", "Action", "Sci-Fi", "Family", "Fantasy", "Animation", "Drama", "Adventure", "Thriller", "Musical"]); // Fallback
            }
            setGeneratingMessage('');
        };
        fetchInitialGenres();
    }, []); // Runs only once on initial mount

    // --- Memoized Calculations ---
    const filteredMovies = useMemo(() => {
        if (!searchTerm && filters.eras.length === 0) return movies;
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

    // --- Action Handlers ---
    const handleRating = useCallback(async (movieId, rating) => {
        const movieRef = doc(db, "movies", movieId);
        await setDoc(movieRef, { ratings: { [currentUser]: rating } }, { merge: true });
    }, [currentUser]);

    const handleReview = useCallback(async (movieId, reviewText) => {
        await setDoc(doc(db, "movies", movieId), { reviews: { [currentUser]: reviewText } }, { merge: true });
    }, [currentUser]);

    const handleLastWatched = useCallback(async (movieId, watched) => {
        const movieRef = doc(db, "movies", movieId);
        let timestamp = new Date();
        if (watched === "A While Ago (~3yr)") timestamp.setFullYear(timestamp.getFullYear() - 3);
        else if (watched === "A Long Time Ago (>5yr)") timestamp.setFullYear(timestamp.getFullYear() - 5);
        await setDoc(movieRef, { lastWatched: timestamp }, { merge: true });
    }, []);

    const handleGenerateSuggestions = useCallback(async (baseMovie = null) => {
        setIsGenerating(true);
        setGeneratingMessage(baseMovie ? `Finding movies like ${baseMovie.title}...` : 'Generating new suggestions...');
        setRecommendations([]);
        setError(null);

        const familyProfile = Object.entries(FAMILY_MEMBERS).map(([name, data]) => `${name} (age ${CURRENT_YEAR - data.born})`).join(', ');
        // UPDATED: Now includes review text in the context for Gemini
        const ratedMovies = movies.filter(m => m.ratings && Object.keys(m.ratings).length > 0)
            .map(m => {
                const userReviews = m.reviews ? Object.entries(m.reviews).map(([user, review]) => `${user} commented: "${review}"`).join(', ') : '';
                return `Title: ${m.title}, Family Avg Rating: ${calculateFamilyAverage(m.ratings)}/5. ${userReviews}`;
            }).slice(0, 20).join('; ');

        const existingLibrary = movies.map(m => m.title).join(', ');
        let prompt;
        if (baseMovie) {
            prompt = `Act as a movie recommender for this family: ${familyProfile}. Generate 12 new movie suggestions very similar to "${baseMovie.title}". Exclude movies already in their library: ${existingLibrary}.`;
        } else {
            prompt = `Act as a movie recommender for this family: ${familyProfile}. Their rating and comment history is: ${ratedMovies || 'None yet'}. Generate 12 new movie suggestions based on their profile, ratings, comments, and these filters: Eras: ${filters.eras.join(', ') || 'Any'}; Genres: ${filters.genres.join(', ') || 'Any'}; Moods: ${filters.moods.join(', ') || 'Any'}. Find novel recommendations and exclude movies already in their library: ${existingLibrary}.`;
        }

        const schema = { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, year: { type: "INTEGER" } }, required: ["title", "year"] } };
        const suggestions = await callGeminiAPI(prompt, schema);

        if (suggestions) {
            setRecommendations(suggestions.map(s => ({ ...s, id: `rec-${s.title.replace(/\s/g, '')}`, posterUrl: `https://placehold.co/500x750/171717/FFFFFF?text=${encodeURIComponent(s.title)}`, isSuggestion: true })));
        }
        setIsGenerating(false);
        setGeneratingMessage('');
    }, [movies, filters]);

    // ... other handlers like handleSeedDatabase, handleRefreshGenres can be added here if needed, following the same pattern ...

    // --- Render Logic ---
    if (!authReady || (isLoading && movies.length === 0)) {
        return <LoadingScreen message={isLoading ? "Connecting to library..." : "Authenticating..."} />;
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
                    <FilterPanel filters={filters} onFilterChange={(type, value) => setFilters(prev => ({ ...prev, [type]: prev[type].includes(value) ? prev[type].filter(v => v !== value) : [...prev[type], value] }))} dynamicGenres={dynamicGenres} onGenerateSuggestions={() => handleGenerateSuggestions()} isGenerating={isGenerating} />
                </div>

                {error && <div className="bg-red-500/20 text-red-300 p-4 rounded-lg mb-8">{error}</div>}

                {(isGenerating || recommendations.length > 0) && (
                    <section className="mb-12">
                        <h2 className="text-2xl font-semibold text-gray-300 mb-4">Suggestions for You</h2>
                        {isGenerating && recommendations.length === 0
                            ? <LoadingScreen message={generatingMessage} />
                            : <MovieGrid movies={recommendations} currentUser={currentUser} onMovieSelect={setSelectedMovie} onRate={handleRating} onReview={handleReview} onMoreLikeThis={handleGenerateSuggestions} />
                        }
                    </section>
                )}

                <main>
                    <h2 className="text-2xl font-semibold text-gray-300 mb-4">Your Movie Library</h2>
                    {movies.length > 0 ? (
                        <MovieGrid movies={filteredMovies} currentUser={currentUser} onMovieSelect={setSelectedMovie} onRate={handleRating} onReview={handleReview} onMoreLikeThis={handleGenerateSuggestions} />
                    ) : (
                        <div className="text-center py-16 bg-neutral-800/50 rounded-lg">
                            <p className="text-gray-400">Your library is empty. Rate some movies to build it up!</p>
                        </div>
                    )}
                </main>
            </div>
            {selectedMovie && <MovieModal movie={selectedMovie} onClose={() => setSelectedMovie(null)} currentUser={currentUser} onRate={handleRating} onReview={handleReview} onLastWatched={handleLastWatched} />}
        </div>
    );
}

// --- Sub-Components ---

const UserSelector = ({ currentUser, onUserChange }) => (
    <div className="flex space-x-2 bg-neutral-800 p-2 rounded-lg">
        {Object.keys(FAMILY_MEMBERS).map(user => (<button key={user} onClick={() => onUserChange(user)} className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors duration-200 ${currentUser === user ? 'bg-indigo-500 text-white' : 'bg-neutral-700 hover:bg-neutral-600 text-gray-300'}`}>{user}</button>))}
    </div>
);

const SearchBar = ({ searchTerm, onSearch }) => (
    <div className="mb-6"><input type="text" placeholder="Search your rated movies..." value={searchTerm} onChange={e => onSearch(e.target.value)} className="w-full bg-neutral-700 border border-neutral-600 rounded-lg py-3 px-4 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" /></div>
);

const FilterPanel = ({ filters, onFilterChange, dynamicGenres, onGenerateSuggestions, isGenerating }) => (
    <div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
                <h4 className="font-semibold mb-3 text-gray-400">Eras</h4>
                <div className="flex flex-wrap gap-2">{ERAS.map(v => <FilterButton key={v} type="eras" value={v} filters={filters} onChange={onFilterChange} />)}</div>
            </div>
            <div>
                <h4 className="font-semibold mb-3 text-gray-400">Genres</h4>
                <div className="flex flex-wrap gap-2">{dynamicGenres.length > 0 ? dynamicGenres.slice(0, 15).map(v => <FilterButton key={v} type="genres" value={v} filters={filters} onChange={onFilterChange} />) : <p className="text-sm text-gray-500">Loading genres...</p>}</div>
            </div>
            <div>
                <h4 className="font-semibold mb-3 text-gray-400">Moods</h4>
                <div className="flex flex-wrap gap-2">{INITIAL_MOODS.map(v => <FilterButton key={v} type="moods" value={v} filters={filters} onChange={onFilterChange} />)}</div>
            </div>
        </div>
        <div className="mt-6 text-center"><button onClick={onGenerateSuggestions} disabled={isGenerating} className="w-full md:w-auto bg-green-500 hover:bg-green-600 disabled:bg-green-800 disabled:cursor-not-allowed text-white font-bold py-3 px-8 rounded-lg transition-all duration-300 shadow-lg">{isGenerating ? 'Generating...' : 'Generate Suggestions'}</button></div>
    </div>
);

const FilterButton = ({ type, value, filters, onChange }) => (
    <button onClick={() => onChange(type, value)} className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 border-2 ${filters[type].includes(value) ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-neutral-700 border-neutral-600 hover:border-indigo-500 text-gray-300'}`}>{value}</button>
);

const MovieGrid = ({ movies, currentUser, onMovieSelect, onRate, onReview, onMoreLikeThis }) => (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 md:gap-8">
        {movies.map(movie => <MovieCard key={movie.id} movie={movie} currentUser={currentUser} onMovieSelect={onMovieSelect} onRate={onRate} onReview={onReview} onMoreLikeThis={onMoreLikeThis} />)}
    </div>
);

// UPDATED: Includes interactive comment input
const MovieCard = ({ movie, currentUser, onMovieSelect, onRate, onReview, onMoreLikeThis }) => {
    const familyAvg = useMemo(() => calculateFamilyAverage(movie.ratings), [movie.ratings]);
    const userRating = movie.ratings?.[currentUser] || 0;
    const userReview = movie.reviews?.[currentUser] || '';
    const [reviewText, setReviewText] = useState(userReview);

    const handleReviewBlur = (e) => {
        if (reviewText !== userReview) {
            onReview(movie.id, reviewText);
        }
    };
    
    // Prevent event bubbling up to the main card click handler
    const stopPropagation = (e) => e.stopPropagation();

    return (
        <div onClick={() => onMovieSelect(movie)} className="bg-neutral-800 rounded-lg overflow-hidden shadow-lg transform hover:-translate-y-1.5 transition-transform duration-300 flex flex-col group cursor-pointer">
            <div className="relative pt-[150%]">
                <img src={movie.posterUrl} alt={movie.title} className="absolute top-0 left-0 w-full h-full object-cover" onError={e => { e.target.onerror = null; e.target.src = `https://placehold.co/500x750/171717/FFFFFF?text=${encodeURIComponent(movie.title)}` }} />
                {familyAvg > 0 && (
                    <div className="absolute top-2 right-2 bg-black/70 rounded-full flex items-center p-1.5 backdrop-blur-sm">
                        <StarIcon className="w-4 h-4 text-yellow-400" />
                        <span className="text-white font-bold text-sm ml-1">{familyAvg.toFixed(1)}</span>
                    </div>
                )}
            </div>
            <div className="p-4">
                <h3 className="font-bold text-lg text-gray-200 truncate" title={movie.title}>{movie.title}</h3>
                <p className="text-sm text-gray-500">{movie.year}</p>
            </div>
            <div className="p-4 pt-0 mt-auto" onClick={stopPropagation}>
                {!movie.isSuggestion && (
                    <div className="border-t border-neutral-700/60 pt-4 space-y-3">
                        <div>
                            <p className="text-sm font-semibold text-indigo-300 mb-2">Your Rating ({currentUser})</p>
                            <StarRating rating={userRating} onRate={(rating) => onRate(movie.id, rating)} interactive={true} size="md" />
                        </div>
                        <div>
                            <input
                                type="text"
                                value={reviewText}
                                onChange={(e) => setReviewText(e.target.value)}
                                onBlur={handleReviewBlur}
                                placeholder="Add a comment..."
                                className="w-full bg-neutral-700 text-sm border border-neutral-600 rounded-md py-1.5 px-2 text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                        </div>
                    </div>
                )}
                <div className="mt-4">
                    <button onClick={() => onMoreLikeThis(movie)} className="w-full text-sm bg-indigo-500/20 text-indigo-300 px-2 py-2 rounded hover:bg-indigo-500/40 transition-colors">More like this</button>
                </div>
            </div>
        </div>
    );
};

const MovieModal = ({ movie, onClose, currentUser, onRate, onReview, onLastWatched }) => {
    const userRating = movie.isSuggestion ? 0 : movie.ratings?.[currentUser] || 0;
    const userReview = movie.isSuggestion ? '' : movie.reviews?.[currentUser] || '';
    const [reviewText, setReviewText] = useState(userReview);

    const handleReviewBlur = () => { if (reviewText !== userReview && !movie.isSuggestion) onReview(movie.id, reviewText); };

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-neutral-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-full overflow-y-auto flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>
                <div className="w-full md:w-1/3 flex-shrink-0"><img src={movie.posterUrl} alt={movie.title} className="w-full h-auto object-cover rounded-t-lg md:rounded-l-lg md:rounded-tr-none" onError={e => { e.target.onerror = null; e.target.src = `https://placehold.co/500x750/171717/FFFFFF?text=${encodeURIComponent(movie.title)}` }} /></div>
                <div className="p-6 md:p-8 flex-grow">
                    <div className="flex justify-between items-start"><h2 className="text-3xl font-bold text-white">{movie.title}</h2><button onClick={onClose} className="text-4xl text-gray-400 hover:text-white leading-none">&times;</button></div>
                    <p className="text-lg text-gray-400 mb-4">{movie.year}</p>

                    {!movie.isSuggestion && (<>
                        <div className="bg-neutral-700/50 p-4 rounded-lg my-6">
                            <h4 className="font-semibold text-lg mb-3 text-indigo-300">Your Rating ({currentUser})</h4>
                            <div className="mb-4"><StarRating rating={userRating} onRate={(rating) => onRate(movie.id, rating)} interactive={true} size="lg" /></div>
                            <textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} onBlur={handleReviewBlur} placeholder={`What did you think, ${currentUser}?`} className="w-full bg-neutral-900/50 border border-neutral-600 rounded-lg p-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" rows="3"></textarea>
                        </div>
                        <div className="my-6">
                            <h4 className="font-semibold text-lg mb-3 text-gray-300">Last Watched</h4>
                            <div className="flex flex-wrap gap-2">{["Recent (<1yr)", "A While Ago (~3yr)", "A Long Time Ago (>5yr)"].map(val => <button key={val} onClick={() => onLastWatched(movie.id, val)} className="bg-neutral-700 hover:bg-neutral-600 text-gray-300 font-semibold py-2 px-4 rounded-lg transition-colors">{val}</button>)}</div>
                        </div>
                    </>)}
                    {movie.isSuggestion && <div className="p-4 my-6 bg-indigo-500/10 rounded-lg text-indigo-200">This is a new suggestion. Rate it after you watch to add it to your library!</div>}

                    <div className="my-6">
                        <h4 className="font-semibold text-lg mb-3 text-gray-300">Search on Streaming</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <StreamIconButton platform="Netflix" title={movie.title} />
                            <StreamIconButton platform="Prime Video" title={movie.title} />
                            <StreamIconButton platform="YouTube" title={movie.title} />
                            <StreamIconButton platform="Hulu" title={movie.title} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const LoadingScreen = ({ message }) => (<div className="text-center py-16"><svg className="animate-spin h-10 w-10 text-indigo-400 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><p className="text-lg text-gray-400 animate-pulse">{message}</p></div>);

// --- SVG Icons & Utility Components ---
const StarRating = ({ rating, onRate, interactive, size = 'md' }) => {
    const [hoverRating, setHoverRating] = useState(0);
    const starSize = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }[size];
    return (<div className={`flex items-center ${interactive ? 'interactive-element' : ''}`}>{ [1, 2, 3, 4, 5].map(star => <div key={star} className={`cursor-${interactive ? 'pointer' : 'default'}`} onMouseEnter={() => interactive && setHoverRating(star)} onMouseLeave={() => interactive && setHoverRating(0)} onClick={() => interactive && onRate(star)}><StarIcon className={`${starSize} transition-colors ${(hoverRating || rating) >= star ? 'text-yellow-400' : 'text-neutral-600'}`} /></div>)}</div>);
};

const StarIcon = (props) => (<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.007z"/></svg>);

const StreamIconButton = ({ platform, title }) => {
    const urls = {
        Netflix: `https://www.netflix.com/search?q=${encodeURIComponent(title)}`,
        'Prime Video': `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${encodeURIComponent(title)}`,
        YouTube: `https://www.youtube.com/results?search_query=${encodeURIComponent(title)}`,
        Hulu: `https://www.hulu.com/search?q=${encodeURIComponent(title)}`,
    };
    return <a href={urls[platform]} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-full bg-neutral-700 hover:bg-neutral-600 text-gray-200 font-semibold py-3 px-4 rounded-lg transition-colors"><span className="mr-2">{platform}</span></a>;
};

// --- Data Calculation Utilities ---
const calculateAverage = (ratings) => { if (!ratings || Object.keys(ratings).length === 0) return 0; const values = Object.values(ratings); return values.reduce((sum, val) => sum + val, 0) / values.length; };
const calculateFamilyAverage = (ratings) => calculateAverage(ratings);

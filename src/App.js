import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, serverTimestamp, writeBatch, Timestamp, updateDoc } from 'firebase/firestore';
import { Star, X, Film, Sparkles, MoreHorizontal, RefreshCw } from 'lucide-react';

// --- Configuration ---
// Hardcoding keys to bypass environment variable issues.
const firebaseConfig = {
    apiKey: "AIzaSyA9dCUAUx2xKs99X211d7-bhUK2TSWYT5I",
    authDomain: "family-movie-night-app.firebaseapp.com",
    projectId: "family-movie-night-app",
    storageBucket: "family-movie-night-app.firebasestorage.app",
    messagingSenderId: "804729919764",
    appId: "1:804729919764:web:607b3447668de29ffe0a01"
};
const appId = 'family-movie-night-app-prod'; // A static ID for the app instance
const TMDB_API_KEY = "70bd2a7c6410d4a6dcd03f71ca9edc70"; // Hardcoded TMDB key

// --- Firebase Initialization ---
let app;
let auth;
let db;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (error) {
    console.error("Firebase initialization failed:", error);
}


// --- Static Data ---
const USERS = { 'Kate': { name: 'Kate', birthYear: 1978, type: 'adult' }, 'Ryan': { name: 'Ryan', birthYear: 1978, type: 'adult' }, 'Ellie': { name: 'Ellie', birthYear: 2011, baseAge: 14, type: 'kid' }, 'Quinn': { name: 'Quinn', birthYear: 2014, baseAge: 11, type: 'kid' }};
const ERAS = ["Pre-80s Classics", "80s Throwbacks", "90s Gems", "2000s Hits", "Modern (2010+)"];
const GENRES = ["Action", "Adventure", "Animation", "Comedy", "Coming-of-Age", "Crime", "Documentary", "Drama", "Family", "Fantasy", "Heartwarming", "History", "Horror", "Music", "Musical", "Mystery", "Quirky Comedy", "Rom-Com", "Sci-Fi", "Sport", "Thriller", "War", "Western"];
const MOODS = ["A Cozy Night In", "Need a Good Laugh", "Let's Go on an Adventure", "Something to Make Us Think", "A Blast from the Past", "We're Feeling Silly", "Heartwarming & Feel-Good", "Edge-of-Our-Seats", "Turn Our Brains Off", "Watch a Classic", "Visually Spectacular", "A Story that Sticks"];

// --- Helper Functions ---
const calculateAge = (user) => { const currentYear = new Date().getFullYear(); if (user.birthYear) return currentYear - user.birthYear; const yearDiff = currentYear - 2025; return user.baseAge + yearDiff; };
const getStreamingSearchUrl = (platform, title) => { const encodedTitle = encodeURIComponent(title); switch (platform) { case 'Netflix': return `https://www.netflix.com/search?q=${encodedTitle}`; case 'Hulu': return `https://www.hulu.com/search?q=${encodedTitle}`; case 'Prime': return `https://www.amazon.com/s?k=${encodedTitle}&i=instant-video`; case 'Apple': return `https://tv.apple.com/us/search?term=${encodedTitle}`; case 'Max': return `https://play.max.com/search/${encodedTitle}`; case 'Peacock': return `https://www.peacocktv.com/watch/search?q=${encodedTitle}`; case 'YouTube': return `https://www.youtube.com/results?search_query=${encodedTitle}+movie`; default: return '#'; }};
const getAverageRating = (movie) => { if (!movie.ratings || Object.keys(movie.ratings).length === 0) return 0; const allRatings = Object.values(movie.ratings); return allRatings.reduce((a, b) => a + b, 0) / allRatings.length; };

// --- Child Components ---
const StarRating = ({ rating, setRating, interactive = true }) => ( <div className="flex items-center space-x-1"> {[...Array(5)].map((_, i) => { const ratingValue = i + 1; return ( <label key={i}> <input type="radio" name={`rating-${Math.random()}`} value={ratingValue} onClick={() => interactive && setRating(ratingValue)} className="hidden" /> <Star className={`cursor-pointer transition-colors duration-200 ${ratingValue <= rating ? 'text-yellow-400' : 'text-gray-500'} ${interactive ? 'hover:text-yellow-300' : ''}`} fill={ratingValue <= rating ? 'currentColor' : 'none'} size={20} /> </label> ); })} </div> );
const MultiSelectButtons = ({ title, options, selected, setSelected, onRefresh, isRefreshing }) => ( <div> <div className="flex items-center gap-2 mb-2"> <h3 className="text-md font-semibold text-gray-300">{title}</h3> {onRefresh && ( <button onClick={onRefresh} disabled={isRefreshing} className="text-teal-400 hover:text-teal-300 disabled:text-gray-500 disabled:cursor-not-allowed"> <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} /> </button> )} </div> <div className="flex flex-wrap gap-2"> {options.map(option => { const isSelected = selected.includes(option); return ( <button key={option} onClick={() => setSelected(prev => prev.includes(option) ? prev.filter(o => o !== option) : [...prev, option])} className={`px-3 py-1.5 text-sm rounded-full transition-colors duration-200 ${isSelected ? 'bg-teal-500 text-white font-semibold' : 'bg-gray-700 hover:bg-gray-600'}`}> {option} </button> ); })} </div> </div> );
const MovieCard = ({ movie, onCardClick, onMoreLikeThis, onRate, currentUser }) => { const adultAvg = useMemo(() => { if (!movie.ratings) return 0; const adultRatings = Object.entries(movie.ratings).filter(([name]) => USERS[name]?.type === 'adult').map(([, r]) => r); return adultRatings.length ? adultRatings.reduce((a, b) => a + b, 0) / adultRatings.length : 0; }, [movie.ratings]); const kidAvg = useMemo(() => { if (!movie.ratings) return 0; const kidRatings = Object.entries(movie.ratings).filter(([name]) => USERS[name]?.type === 'kid').map(([, r]) => r); return kidRatings.length ? kidRatings.reduce((a, b) => a + b, 0) / kidRatings.length : 0; }, [movie.ratings]); const handleDirectRate = (type, value) => { const ratingPayload = type === 'adult' ? { adultRating: value } : { kidRating: value }; onRate(movie, ratingPayload, "", 'recent'); }; const userType = USERS[currentUser]?.type; return ( <div className="bg-gray-800 rounded-lg shadow-lg overflow-hidden transform hover:scale-105 transition-transform duration-300 flex flex-col"> <div className="flex-grow flex p-3 space-x-3"> <div className="w-1/3 flex-shrink-0 cursor-pointer" onClick={() => onCardClick(movie)}> <img src={movie.posterUrl || `https://placehold.co/300x450/1f2937/a5f3fc?text=${encodeURIComponent(movie.title)}`} alt={`Poster for ${movie.title}`} className="w-full h-auto object-cover rounded-md" onError={(e) => { e.target.onerror = null; e.target.src=`https://placehold.co/300x450/1f2937/a5f3fc?text=${encodeURIComponent(movie.title)}`; }}/> </div> <div className="w-2/3 flex flex-col justify-between"> <div> <h3 className="text-lg font-bold text-white cursor-pointer" onClick={() => onCardClick(movie)}>{movie.title} ({movie.year})</h3> <div className="mt-2 space-y-2 text-sm"> <div className="flex items-center"> <span className="w-16">Adults:</span> <StarRating rating={adultAvg} interactive={userType === 'adult'} setRating={(val) => handleDirectRate('adult', val)} /> </div> <div className="flex items-center"> <span className="w-16">Kids:</span> <StarRating rating={kidAvg} interactive={userType === 'kid'} setRating={(val) => handleDirectRate('kid', val)} /> </div> </div> </div> <button onClick={() => onMoreLikeThis(movie)} className="mt-3 w-full text-xs bg-teal-600 hover:bg-teal-500 text-white font-semibold py-1.5 px-2 rounded-md flex items-center justify-center transition-colors"> <Sparkles size={14} className="mr-1.5" /> More like this </button> </div> </div> <div className="px-3 pb-3 text-xs"> <p className="font-semibold mb-1.5 text-gray-400">Stream/Rent:</p> <div className="grid grid-cols-4 gap-2"> {['Netflix', 'Prime', 'Hulu', 'Max', 'Apple', 'Peacock', 'YouTube'].map(p => ( <a key={p} href={getStreamingSearchUrl(p, movie.title)} target="_blank" rel="noopener noreferrer" className="text-center bg-gray-700 hover:bg-gray-600 rounded py-1 transition-colors">{p.replace('Prime', 'APV')}</a> ))} </div> </div> </div> ); };
const MovieModal = ({ movie, onClose, onRate, currentUser }) => { const [adultRating, setAdultRating] = useState(0); const [kidRating, setKidRating] = useState(0); const [review, setReview] = useState(''); const [timeframe, setTimeframe] = useState(null); useEffect(() => { const currentUserData = USERS[currentUser]; if (movie && movie.ratings) { if (currentUserData.type === 'adult') setAdultRating(movie.ratings[currentUser] || 0); else setKidRating(movie.ratings[currentUser] || 0); } if (movie && movie.reviews) { setReview(movie.reviews[currentUser] || ''); } setTimeframe(null); }, [movie, currentUser]); if (!movie) return null; const handleSaveRating = () => { const ratingPayload = {}; if (adultRating > 0) ratingPayload.adultRating = adultRating; if (kidRating > 0) ratingPayload.kidRating = kidRating; onRate(movie, ratingPayload, review, timeframe); onClose(); }; const timeSinceWatched = () => { if (!movie.lastWatched) return "Not watched yet"; const diffYears = (new Date() - movie.lastWatched.toDate()) / (1000 * 60 * 60 * 24 * 365); if (diffYears < 1) return "Less than a year ago"; if (diffYears < 3) return "1-3 years ago"; return "3-5 years ago"; }; return ( <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex items-center justify-center p-4"> <div className="bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto relative"> <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 hover:text-white"><X size={24} /></button> <div className="flex flex-col md:flex-row p-6 space-y-4 md:space-y-0 md:space-x-6"> <div className="md:w-1/3 flex-shrink-0"><img src={movie.posterUrl || `https://placehold.co/300x450/1f2937/a5f3fc?text=${encodeURIComponent(movie.title)}`} alt={`Poster for ${movie.title}`} className="w-full h-auto object-cover rounded-md" onError={(e) => { e.target.onerror = null; e.target.src=`https://placehold.co/300x450/1f2937/a5f3fc?text=${encodeURIComponent(movie.title)}`; }}/></div> <div className="md:w-2/3 flex flex-col"> <h2 className="text-3xl font-bold text-white">{movie.title} ({movie.year})</h2> {movie.lastWatched && <p className="text-sm text-gray-400 mt-1">Last watched: {timeSinceWatched()}</p>} <div className="mt-4 border-t border-gray-700 pt-4"> <h3 className="font-semibold text-lg text-teal-400 mb-2">Rate this movie</h3> <p className="text-sm text-gray-400 mb-3">You are rating as <span className="font-bold text-white">{currentUser}</span>.</p> <div className="space-y-3"> {USERS[currentUser].type === 'adult' && (<div className="flex items-center"><span className="w-24">Adults' Rating:</span><StarRating rating={adultRating} setRating={setAdultRating} /></div>)} {USERS[currentUser].type === 'kid' && (<div className="flex items-center"><span className="w-24">Kids' Rating:</span><StarRating rating={kidRating} setRating={setKidRating} /></div>)} </div> </div> <div className="mt-4 border-t border-gray-700 pt-4"> <h3 className="font-semibold text-lg text-teal-400 mb-2">When did you last watch this?</h3> <div className="flex flex-col sm:flex-row gap-2"> {[{label: 'Recent (<1yr)', value: 'recent'}, {label: 'A While Ago (~3yr)', value: 'awhile'}, {label: 'A Long Time Ago (>5yr)', value: 'longtime'}].map(item => ( <button key={item.value} onClick={() => setTimeframe(item.value)} className={`w-full px-3 py-1.5 text-sm rounded-md transition-colors duration-200 ${timeframe === item.value ? 'bg-teal-500 text-white font-semibold' : 'bg-gray-700 hover:bg-gray-600'}`}> {item.label} </button> ))} </div> </div> <div className="mt-4 border-t border-gray-700 pt-4 flex-grow flex flex-col"> <h3 className="font-semibold text-lg text-teal-400 mb-2">Your Review</h3> <textarea value={review} onChange={(e) => setReview(e.target.value)} placeholder={`What did ${currentUser} think?`} className="w-full h-24 p-2 bg-gray-900 rounded-md text-gray-300 resize-none flex-grow"></textarea> </div> <div className="mt-4 pt-4 border-t border-gray-700"> <button onClick={handleSaveRating} className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-2 px-4 rounded-md transition-colors">Save Rating & Review</button> </div> </div> </div> </div> </div> ); };

export default function App() {
    const [currentUser, setCurrentUser] = useState('Kate');
    const [movies, setMovies] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [selectedMovie, setSelectedMovie] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [isRefreshingGenres, setIsRefreshingGenres] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEras, setSelectedEras] = useState([]);
    const [dynamicGenres, setDynamicGenres] = useState(GENRES);
    const [selectedGenres, setSelectedGenres] = useState([]);
    const [selectedMoods, setSelectedMoods] = useState([]);

    useEffect(() => {
        if (!auth) {
            console.log("Firebase not configured. Waiting...");
            setIsLoading(false);
            return;
        };
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setIsAuthReady(true);
            } else {
                try {
                    await signInAnonymously(auth);
                    setIsAuthReady(true);
                } catch (error) { console.error("Anonymous sign-in failed:", error); }
            }
        });
        return () => unsubscribe();
    }, []);

    const moviesCollectionRef = useMemo(() => {
        if (!isAuthReady || !db) return null;
        return collection(db, 'artifacts', appId, 'public', 'data', 'movies');
    }, [isAuthReady]);

    useEffect(() => {
        if (!moviesCollectionRef) {
             setIsLoading(false);
            return;
        }
        setIsLoading(true);
        const unsubscribe = onSnapshot(moviesCollectionRef, (snapshot) => {
            const moviesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMovies(moviesData);
            setIsLoading(false);
        }, (error) => { console.error("Firestore snapshot error:", error); setIsLoading(false); });
        return () => unsubscribe();
    }, [moviesCollectionRef]);

    const handleGenreRefresh = useCallback(async () => {
        setIsRefreshingGenres(true);
        const highRatedMovies = movies.filter(m => getAverageRating(m) >= 4).map(m => `"${m.title}"`).slice(0, 20).join(', ');
        if (!highRatedMovies) { alert("Please rate some movies (4+ stars) to generate personalized genres!"); setIsRefreshingGenres(false); return; }
        const prompt = `Based on this list of highly-rated movies: ${highRatedMovies}, invent 3 to 5 new, creative, and blended genre categories that capture the family's taste. Return ONLY a JSON array of strings, like ["New Genre 1", "New Genre 2"].`;
        try {
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } };
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await response.json();
            if (result.candidates && result.candidates[0].content.parts[0].text) {
                const newGenres = JSON.parse(result.candidates[0].content.parts[0].text);
                setDynamicGenres(prev => [...new Set([...prev, ...newGenres])]);
            }
        } catch (error) { console.error('Error refreshing genres:', error); alert("Sorry, there was an error refreshing genres."); } finally { setIsRefreshingGenres(false); }
    }, [movies]);
    
    const fetchMovieDetails = useCallback(async (movie) => {
        try { const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movie.title)}&year=${movie.year}`; const searchRes = await fetch(searchUrl); const searchData = await searchRes.json(); if (!searchData.results || searchData.results.length === 0) return { ...movie, posterUrl: null, id: `${movie.title}-${movie.year}` }; const tmdbMovie = searchData.results[0]; const posterPath = tmdbMovie.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbMovie.poster_path}` : null; return { ...movie, posterUrl: posterPath, id: tmdbMovie.id.toString() };
        } catch (error) { console.error(`Failed to fetch details for ${movie.title}`, error); return { ...movie, posterUrl: null, id: `${movie.title}-${movie.year}` }; }
    }, []);

    const batchAddMovies = useCallback(async (moviesToAdd) => { if (!moviesCollectionRef) return; const batch = writeBatch(db); const moviesWithDetails = await Promise.all(moviesToAdd.map(fetchMovieDetails)); moviesWithDetails.forEach(movie => { if (movie.id) { const docRef = doc(moviesCollectionRef, movie.id); batch.set(docRef, { title: movie.title, year: movie.year, posterUrl: movie.posterUrl, ratings: {}, reviews: {}, createdAt: serverTimestamp() }, { merge: true }); } }); await batch.commit(); }, [moviesCollectionRef, fetchMovieDetails]);

    const generateSuggestions = useCallback(async (promptConfig) => {
        setIsLoading(true);
        setSuggestions([]);
        const familyAges = Object.values(USERS).map(u => `${u.name} (age ${calculateAge(u)})`).join(', ');
        const ratedMoviesHistory = movies.filter(m => m.ratings && Object.keys(m.ratings).length > 0).map(m => { const adultRatings = Object.entries(m.ratings).filter(([name]) => USERS[name]?.type === 'adult').map(([, r]) => r); const kidRatings = Object.entries(m.ratings).filter(([name]) => USERS[name]?.type === 'kid').map(([, r]) => r); const adultAvg = adultRatings.length ? (adultRatings.reduce((a, b) => a + b, 0) / adultRatings.length).toFixed(1) : 'N/A'; const kidAvg = kidRatings.length ? (kidRatings.reduce((a, b) => a + b, 0) / kidRatings.length).toFixed(1) : 'N/A'; return `${m.title} (${m.year}) - Adult Avg: ${adultAvg}, Kid Avg: ${kidAvg}`; }).join('\n');
        let prompt;
        if (promptConfig.type === 'initial') { prompt = `You are a movie recommendation expert for a family. Their favorite movies include: 10 Things I Hate About You, Clueless, The Goonies, The Breakfast Club, Harry and the Hendersons, Adventures in Babysitting, High Fidelity. Generate a diverse list of 50 movies from the 80s, 90s, and early 2000s that this family would likely enjoy. Return ONLY a JSON array of objects, like this: [{"title": "Movie Title", "year": 1985}].`;
        } else if (promptConfig.type === 'moreLikeThis') { prompt = `You are a movie recommendation expert for a family. Family members: ${familyAges}. They want more movies like "${promptConfig.movie.title} (${promptConfig.movie.year})". Their rating history is:\n${ratedMoviesHistory}\nSuggest 10 movies similar in theme and genre. Avoid suggesting movies from their history. Return ONLY a JSON array of objects, like this: [{"title": "Movie Title", "year": 1999}].`;
        } else { prompt = `You are a movie recommendation expert for a family. Family members: ${familyAges}. Their favorite movies include: 10 Things I Hate About You, Clueless, The Goonies. Their rating history is:\n${ratedMoviesHistory}\nGenerate 10 movie suggestions based on these criteria: Eras: ${selectedEras.join(', ') || 'any'}; Genres: ${selectedGenres.join(', ') || 'any'}; User Moods: ${selectedMoods.join(', ') || 'any'}. Avoid suggesting movies from their history. Return ONLY a JSON array of objects, like this: [{"title": "Movie Title", "year": 2001}].`; }
        try {
            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } };
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const result = await response.json();
            let generatedMovies = [];
            if (result.candidates && result.candidates[0].content.parts[0].text) {
                let jsonString = result.candidates[0].content.parts[0].text;
                const startIndex = jsonString.indexOf('[');
                const endIndex = jsonString.lastIndexOf(']');
                if (startIndex !== -1 && endIndex !== -1) {
                    jsonString = jsonString.substring(startIndex, endIndex + 1);
                    try { generatedMovies = JSON.parse(jsonString); } catch(e) { console.error("Failed to parse cleaned JSON:", e); alert("The suggestion engine returned an unexpected format. Please try again."); setIsLoading(false); return; }
                }
            }
            if (promptConfig.type === 'initial') { await batchAddMovies(generatedMovies); alert("Database has been seeded with 50 movies! You can now start rating them.");
            } else { const moviesWithDetails = await Promise.all(generatedMovies.map(fetchMovieDetails)); setSuggestions(moviesWithDetails.filter(m => m.id)); }
        } catch (error) { console.error('Error generating suggestions:', error); alert("Sorry, there was an error getting suggestions."); } finally { setIsLoading(false); }
    }, [movies, selectedEras, selectedGenres, selectedMoods, batchAddMovies, fetchMovieDetails]);

    const handleRateMovie = async (movie, ratings, review, timeframe) => { 
        if (!moviesCollectionRef) return; 
        const docRef = doc(moviesCollectionRef, movie.id); 
        const updatePayload = {};
        if (ratings.adultRating) {
            updatePayload[`ratings.${currentUser}`] = ratings.adultRating;
        }
        if (ratings.kidRating) {
             updatePayload[`ratings.${currentUser}`] = ratings.kidRating;
        }
        if(review) updatePayload[`reviews.${currentUser}`] = review;
        
        if (timeframe) {
            const now = new Date();
            let lastWatchedDate = new Date();
            if (timeframe === 'awhile') lastWatchedDate.setFullYear(now.getFullYear() - 3);
            else if (timeframe === 'longtime') lastWatchedDate.setFullYear(now.getFullYear() - 5);
            updatePayload.lastWatched = Timestamp.fromDate(lastWatchedDate);
        } else if (Object.keys(ratings).length > 0) {
            updatePayload.lastWatched = serverTimestamp();
        }

        if(Object.keys(updatePayload).length > 0){
             try { await updateDoc(docRef, updatePayload); } catch (error) { console.error("Error updating rating:", error); } 
        }
    };
    
    const filteredMovies = useMemo(() => { if (!searchQuery) return movies; return movies.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase())); }, [movies, searchQuery]);
    
    if (configError) {
        return (
            <div className="bg-gray-900 text-white min-h-screen p-8 font-mono">
                <h1 className="text-2xl text-red-500 font-bold mb-4">Configuration Error</h1>
                <p>{configError}</p>
                {configError.includes("JSON") && (
                    <>
                        <p className="mt-4">Here is the exact value the app is trying to use:</p>
                        <pre className="bg-gray-800 p-4 rounded mt-2 whitespace-pre-wrap break-all text-yellow-300">{firebaseConfigRaw}</pre>
                    </>
                )}
            </div>
        );
    }

    return (
        <div className="bg-gray-900 text-gray-200 min-h-screen font-sans p-4 sm:p-6 lg:p-8">
            {selectedMovie && <MovieModal movie={selectedMovie} onClose={() => setSelectedMovie(null)} onRate={handleRateMovie} currentUser={currentUser} />}
            <div className="max-w-7xl mx-auto">
                <header className="text-center mb-6"> <div className="flex justify-center items-center mb-4"><Film className="text-teal-400" size={40} /><h1 className="text-4xl sm:text-5xl font-bold text-white ml-3">Family Movie Night</h1></div> <p className="text-gray-400">Your personal movie recommender.</p> </header>
                <div className="bg-gray-800 p-4 rounded-lg shadow-xl mb-6 sticky top-4 z-20"> <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start"> <div className="md:col-span-1"> <label className="block text-sm font-medium text-gray-400 mb-2">Viewing As:</label> <div className="flex flex-wrap gap-2"> {Object.keys(USERS).map(name => (<button key={name} onClick={() => setCurrentUser(name)} className={`px-3 py-1.5 text-sm rounded-md transition-colors duration-200 ${currentUser === name ? 'bg-teal-500 text-white font-semibold' : 'bg-gray-700 hover:bg-gray-600'}`}>{name}</button>))} </div> </div> <div className="md:col-span-2"> <label className="block text-sm font-medium text-gray-400 mb-2">Find a specific movie in your library:</label> <input type="text" placeholder="Search your rated movies..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-gray-700 p-2 rounded-md" /> </div> </div> </div>
                <div className="bg-gray-800 p-4 rounded-lg shadow-xl mb-8"> <h2 className="text-xl font-semibold mb-4 text-teal-400">Get New Suggestions</h2> <div className="flex flex-col gap-4 mb-4"> <MultiSelectButtons title="Eras" options={ERAS} selected={selectedEras} setSelected={setSelectedEras} /> <MultiSelectButtons title="Genres" options={dynamicGenres} selected={selectedGenres} setSelected={setSelectedGenres} onRefresh={handleGenreRefresh} isRefreshing={isRefreshingGenres} /> <MultiSelectButtons title="Moods" options={MOODS} selected={selectedMoods} setSelected={setSelectedMoods} /> </div> <button onClick={() => generateSuggestions({type: 'generate'})} disabled={isLoading} className="w-full bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 px-4 rounded-md flex items-center justify-center transition-all duration-300 disabled:bg-gray-500"> {isLoading ? <MoreHorizontal className="animate-pulse" /> : <Sparkles className="mr-2"/>} Generate Suggestions </button> </div>
                {suggestions.length > 0 && ( <div className="mb-8"> <h2 className="text-2xl font-bold mb-4 text-white">Top Suggestions For You</h2> <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"> {suggestions.map(movie => (<MovieCard key={movie.id} movie={movie} currentUser={currentUser} onCardClick={setSelectedMovie} onRate={handleRateMovie} onMoreLikeThis={(m) => generateSuggestions({ type: 'moreLikeThis', movie: m })} />))} </div> </div> )}
                <div className="border-t border-gray-700 pt-8"> <h2 className="text-2xl font-bold mb-4 text-white">Your Movie Library ({filteredMovies.length})</h2> {isLoading && movies.length === 0 ? (<p className="text-center text-gray-400">Loading your movie library...</p>) : !isLoading && movies.length === 0 ? ( <div className="text-center bg-gray-800 p-8 rounded-lg"> <h3 className="text-xl font-semibold text-white mb-2">Your Library is Empty!</h3> <p className="text-gray-400 mb-4">Get started by seeding your database with some movie classics.</p> <button onClick={() => generateSuggestions({ type: 'initial' })} disabled={isLoading} className="bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-6 rounded-md flex items-center justify-center mx-auto transition-colors disabled:bg-gray-500"> {isLoading ? <MoreHorizontal className="animate-pulse" /> : <Sparkles className="mr-2"/>} Seed Our Database </button> </div> ) : ( <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"> {filteredMovies.map(movie => (<MovieCard key={movie.id} movie={movie} currentUser={currentUser} onCardClick={setSelectedMovie} onRate={handleRateMovie} onMoreLikeThis={(m) => generateSuggestions({ type: 'moreLikeThis', movie: m })} />))} </div> )} </div>
            </div>
        </div>
    );
}

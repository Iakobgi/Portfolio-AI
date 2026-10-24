const queries = ["hi", "il a q age ?", "?", "quoi ?", "quel age a t il ?"];

async function runTests() {
    for (const q of queries) {
        const response = await fetch('https://portfolio-ai.iakobi.workers.dev/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: q, language: 'fr' })
        });
        const data = await response.json();
        console.log(`"${q}" -> ${data.answer}`);
    }
}

runTests();
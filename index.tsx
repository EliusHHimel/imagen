/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, GeneratedImage, Modality, Type} from '@google/genai';
import JSZip from 'jszip';

// Correct API key usage as per guidelines
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

interface HistoryItem {
    id: number;
    prompt: string;
    model: string;
    thumbnail: string;
    timestamp: number;
}
const HISTORY_STORAGE_KEY = 'imageGenerationHistory';
const GALLERY_INFO_DISMISSED_KEY = 'galleryInfoDismissed';
const DATABASE_API_ENDPOINT = 'https://ai-generated-image-gallery-pi.vercel.app/api/images/all';

// -------------------- STATE ----------------------------------------------------------------
let totalGeneratedCount = 0;
let generationHistory: HistoryItem[] = [];

// -------------------- DOM ELEMENTS ---------------------------------------------------------
const imageGallery = document.getElementById('image-gallery') as HTMLDivElement;
const generateButton = document.getElementById('generate-button') as HTMLButtonElement;
const numImagesInput = document.getElementById('number-of-images') as HTMLInputElement;
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const suggestPromptsButton = document.getElementById('suggest-prompts-button') as HTMLButtonElement;
const suggestionsContainer = document.getElementById('suggestions-container') as HTMLDivElement;
const diverseSubjectsCheckbox = document.getElementById('diverse-subjects') as HTMLInputElement;
const errorContainer = document.getElementById('error-container') as HTMLDivElement;
const errorMessage = document.getElementById('error-message') as HTMLParagraphElement;
const closeErrorButton = document.getElementById('close-error-button') as HTMLButtonElement;
const downloadContainer = document.getElementById('download-container') as HTMLDivElement;
const downloadAllButton = document.getElementById('download-all-button') as HTMLButtonElement;
const galleryCountSpan = document.getElementById('gallery-count') as HTMLSpanElement;
const totalGeneratedCountSpan = document.getElementById('total-generated-count') as HTMLSpanElement;
const progressContainer = document.getElementById('progress-container') as HTMLDivElement;
const progressBar = document.getElementById('progress-bar') as HTMLDivElement;
const progressLabel = document.getElementById('progress-label') as HTMLSpanElement;
const layoutControls = document.getElementById('layout-controls') as HTMLDivElement;
const generationModelSelect = document.getElementById('generation-model') as HTMLSelectElement;
const modelInfo = document.getElementById('model-info') as HTMLDivElement;
const numImagesSetting = document.getElementById('num-images-setting') as HTMLDivElement;
const diverseSubjectsSetting = document.getElementById('diverse-subjects-setting') as HTMLDivElement;
const historyList = document.getElementById('history-list') as HTMLDivElement;
const clearHistoryButton = document.getElementById('clear-history-button') as HTMLButtonElement;
const galleryInfoCallout = document.getElementById('gallery-info-callout') as HTMLDivElement;
const closeGalleryInfoButton = document.getElementById('close-gallery-info') as HTMLButtonElement;


// -------------------- ERROR HANDLING -------------------------------------------------------
function displayError(message: string) {
    if (errorMessage && errorContainer) {
        errorMessage.textContent = `An error occurred: ${message}`;
        errorContainer.classList.remove('hidden');
    }
}

function hideError() {
    if (errorContainer) {
        errorContainer.classList.add('hidden');
    }
}

// -------------------- CAPTION GENERATION ----------------------------------------------------
async function generateCaption(base64ImageData: string, imagePrompt: string): Promise<string> {
    const imagePart = {
        inlineData: {
            mimeType: 'image/png',
            data: base64ImageData,
        },
    };
    const textPart = {
        text: `The user generated this image with the prompt: "${imagePrompt}". Describe the image in a short, descriptive caption that captures its essence.`,
    };
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [imagePart, textPart] },
    });
    return response.text;
}

// -------------------- UI & IMAGE RENDERING -------------------------------------------------

function updateUiCounts(galleryCount: number) {
    galleryCountSpan.textContent = galleryCount.toString();
    totalGeneratedCountSpan.textContent = totalGeneratedCount.toString();
}

function updateProgress(current: number, total: number) {
    const percentage = total > 0 ? (current / total) * 100 : 0;
    progressContainer.classList.remove('hidden');
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = `${percentage}%`;
    progressLabel.textContent = `Generating image ${current} of ${total}...`;
}

function showIndeterminateProgress(message: string) {
    progressContainer.classList.remove('hidden');
    progressBar.classList.add('indeterminate');
    progressBar.style.width = '100%';
    progressLabel.textContent = message;
}

function hideProgress() {
    progressContainer.classList.add('hidden');
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = '0%';
}

function populateImageContainer(
    imageData: GeneratedImage,
    container: HTMLDivElement,
    imagePrompt: string,
    pregeneratedCaption?: string,
) {
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';

    const img = document.createElement('img');
    const base64Image = imageData.image.imageBytes;
    img.src = `data:image/png;base64,${base64Image}`;
    img.alt = imagePrompt;

    const downloadButton = document.createElement('button');
    downloadButton.className = 'download-button';
    downloadButton.setAttribute('aria-label', 'Download image');
    downloadButton.setAttribute('title', 'Download image');
    downloadButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
    downloadButton.onclick = () => {
        const a = document.createElement('a');
        a.href = img.src;
        a.download = `imagen_gen_${Date.now()}.png`;
        a.click();
    };

    imageWrapper.append(img, downloadButton);

    const caption = document.createElement('p');
    caption.className = 'image-caption';
    container.append(imageWrapper, caption);
    
    const finishLoading = () => container.classList.remove('loading');

    img.onerror = () => {
        console.error('Image failed to load.');
        container.innerHTML = '<p class="image-caption">Error loading image.</p>';
        finishLoading();
    };

    if (pregeneratedCaption) {
        caption.textContent = pregeneratedCaption;
        if (img.complete) {
            finishLoading();
        } else {
            img.onload = finishLoading;
        }
    } else {
        caption.textContent = 'Generating caption...';
        img.onload = async () => {
            try {
                const captionText = await generateCaption(base64Image, imagePrompt);
                caption.textContent = captionText;
            } catch (e) {
                console.error('Caption generation failed:', e);
                caption.textContent = 'Could not generate caption.';
            } finally {
                finishLoading();
            }
        };
    }
}


// -------------------- HISTORY MANAGEMENT ----------------------------------------------------

function renderHistory() {
    historyList.innerHTML = '';
    if (generationHistory.length === 0) {
        historyList.innerHTML = '<p class="placeholder">Your generation history will appear here.</p>';
        return;
    }

    generationHistory.forEach(item => {
        const historyItemEl = document.createElement('div');
        historyItemEl.className = 'history-item';
        historyItemEl.setAttribute('role', 'button');
        historyItemEl.tabIndex = 0;
        historyItemEl.title = `Click to reuse this prompt and model`;

        const modelName = item.model === 'imagen-4.0-generate-001' ? 'Imagen 4' : 'Gemini 2.5 Flash Preview';

        historyItemEl.innerHTML = `
            <div class="history-thumbnail">
                <img src="data:image/png;base64,${item.thumbnail}" alt="Thumbnail for prompt: ${item.prompt}">
            </div>
            <div class="history-details">
                <p class="history-prompt">${item.prompt}</p>
                <p class="history-meta">
                    <span>${modelName}</span>
                    <span>${new Date(item.timestamp).toLocaleString()}</span>
                </p>
            </div>
        `;

        historyItemEl.addEventListener('click', () => {
            promptInput.value = item.prompt;
            generationModelSelect.value = item.model;
            // Manually trigger change event to update UI disabilities
            generationModelSelect.dispatchEvent(new Event('change'));
        });
        
        historyItemEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                historyItemEl.click();
            }
        });

        historyList.appendChild(historyItemEl);
    });
}

function saveHistory() {
    try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(generationHistory));
    } catch (e) {
        console.error("Failed to save history to localStorage:", e);
        displayError("Could not save history. Your browser's storage might be full.");
    }
}

function loadHistory() {
    try {
        const savedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (savedHistory) {
            generationHistory = JSON.parse(savedHistory);
            renderHistory();
        } else {
            renderHistory(); // Render the empty state
        }
    } catch (e) {
        console.error("Failed to load history from localStorage:", e);
        generationHistory = [];
        renderHistory();
    }
}

function addToHistory(prompt: string, model: string, image: GeneratedImage) {
    const newItem: HistoryItem = {
        id: Date.now(),
        prompt,
        model,
        thumbnail: image.image.imageBytes,
        timestamp: Date.now(),
    };
    generationHistory.unshift(newItem); // Add to the beginning
    saveHistory();
    renderHistory();
}

function clearHistory() {
    generationHistory = [];
    saveHistory();
    renderHistory();
}

// -------------------- DATABASE INTEGRATION --------------------------------------------------

/**
 * Generates a title and category for an image based on its prompt.
 * @param prompt The user's prompt for the image.
 * @returns An object containing the generated title and category.
 */
async function getImageMetadata(prompt: string): Promise<{ title: string, category: string }> {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Analyze the following user prompt for an image generator. Based on the prompt, provide a short, descriptive title for the image and categorize it into one of the following: Fantasy, Sci-Fi, Nature, Abstract, Portrait, Architecture, Food, Other. Prompt: "${prompt}"`,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        title: {
                            type: Type.STRING,
                            description: 'A short, descriptive title for an image created with this prompt.',
                        },
                        category: {
                            type: Type.STRING,
                            description: 'One of the following categories: Fantasy, Sci-Fi, Nature, Abstract, Portrait, Architecture, Food, Other.',
                        },
                    },
                    required: ['title', 'category'],
                },
            },
        });
        return JSON.parse(response.text);
    } catch (error) {
        console.error('Failed to generate image metadata:', error);
        // Return fallback values
        return {
            title: prompt.substring(0, 50), // Use first 50 chars of prompt as fallback title
            category: 'Other',
        };
    }
}

/**
 * Saves a generated image and its metadata to the remote database.
 * @param imageData Object containing all necessary data for the database entry.
 */
async function saveImageToDatabase(imageData: {
    base64: string,
    prompt: string,
    model: string,
    caption: string
}) {
    try {
        const { title, category } = await getImageMetadata(imageData.prompt);

        const payload = {
            title: title,
            prompt: imageData.prompt,
            category: category,
            model: imageData.model,
            caption: imageData.caption,
            imageData: imageData.base64, // The API expects the raw base64 string
        };
        
        // Fire-and-forget request to attempt to bypass CORS issues for logging.
        // We cannot confirm success from the client, but this prevents "Failed to fetch" errors.
        fetch(DATABASE_API_ENDPOINT, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        console.log('Image data sent to the gallery database.');

    } catch (error) {
        console.error('Failed to prepare and send image data to the database:', error);
        // This is a background task, so we don't show a UI error to the user
    }
}


// -------------------- CORE API CALLS -------------------------------------------------------

async function getDiversePrompts(basePrompt: string, count: number): Promise<string[]> {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Based on the user's core idea of "${basePrompt}", generate exactly ${count} diverse and creative prompts for an AI image generator. Each prompt should explore a different subject or theme (like one fantasy, one sci-fi, one nature, one abstract), but can retain any stylistic elements from the original idea.`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    prompts: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.STRING,
                            description: 'A creative prompt for an AI image generator.'
                        }
                    }
                },
                required: ['prompts'],
            }
        }
    });

    const result = JSON.parse(response.text);
    if (result.prompts && Array.isArray(result.prompts) && result.prompts.length > 0) {
        return result.prompts;
    } else {
        throw new Error('Failed to generate a valid set of diverse prompts.');
    }
}

async function generateImages() {
    if (!promptInput.value) {
        displayError('Please enter a prompt.');
        return;
    }
    const originalButtonText = generateButton.textContent;
    generateButton.textContent = 'Generating...';
    generateButton.disabled = true;
    imageGallery.innerHTML = '';
    downloadContainer.classList.add('hidden');
    hideError();
    updateUiCounts(0);

    const numberOfImages = parseInt(numImagesInput.value, 10);
    const selectedModel = generationModelSelect.value;
    const prompt = promptInput.value;

    for (let i = 0; i < numberOfImages; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'image-container loading';
        imageGallery.appendChild(placeholder);
    }
    const placeholders = Array.from(imageGallery.querySelectorAll('.image-container.loading'));
    let allGeneratedImages: GeneratedImage[] = [];

    try {
        if (selectedModel === 'gemini-2.5-flash-image-preview') {
            let promptsToGenerate: string[] = [];
            if (diverseSubjectsCheckbox.checked && numberOfImages > 1) {
                showIndeterminateProgress('Generating diverse prompts...');
                promptsToGenerate = await getDiversePrompts(prompt, numberOfImages);
            } else {
                promptsToGenerate = Array(numberOfImages).fill(prompt);
            }

            for (let i = 0; i < promptsToGenerate.length; i++) {
                const currentPrompt = promptsToGenerate[i];
                updateProgress(i + 1, promptsToGenerate.length);
                
                try {
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.5-flash-image-preview',
                        contents: { parts: [{ text: currentPrompt }] },
                        config: {
                            responseModalities: [Modality.IMAGE, Modality.TEXT],
                        },
                    });

                    let imageBase64: string | null = null;
                    let captionText = 'Caption not available.';
                    if (response.candidates?.[0]?.content.parts) {
                        for (const part of response.candidates[0].content.parts) {
                            if (part.text) captionText = part.text;
                            else if (part.inlineData) imageBase64 = part.inlineData.data;
                        }
                    }

                    if (imageBase64) {
                        const imageData: GeneratedImage = {
                            image: {
                                imageBytes: imageBase64,
                                mimeType: response.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.mimeType || 'image/png'
                            }
                        };
                        allGeneratedImages.push(imageData);
                        populateImageContainer(imageData, placeholders[i] as HTMLDivElement, currentPrompt, captionText);
                        
                        // Save to database in the background
                        saveImageToDatabase({
                           base64: imageBase64,
                           prompt: currentPrompt,
                           model: selectedModel,
                           caption: captionText,
                        }).catch(err => console.error('DB save failed:', err));

                    } else {
                        throw new Error('Model did not return an image for this prompt.');
                    }
                } catch (e) {
                    console.error(`Failed to generate image ${i + 1}:`, e);
                    if (placeholders[i]) {
                        (placeholders[i] as HTMLDivElement).innerHTML = `<p class="image-caption">Failed to generate image for prompt: "${currentPrompt}"</p>`;
                        (placeholders[i] as HTMLDivElement).classList.remove('loading');
                    }
                }
            }
        } else { // Imagen Model
            const generateAndProcessImage = async (currentPrompt: string, placeholder: HTMLDivElement) => {
                const response = await ai.models.generateImages({
                    model: selectedModel,
                    prompt: currentPrompt,
                    config: { numberOfImages: 1, outputMimeType: 'image/png', aspectRatio: '1:1' },
                });

                if (response.generatedImages && response.generatedImages.length > 0) {
                    const imageData = response.generatedImages[0];
                    const base64Image = imageData.image.imageBytes;
                    
                    let captionText = 'Caption not available.';
                    try {
                        captionText = await generateCaption(base64Image, currentPrompt);
                    } catch (e) {
                         console.error('Caption generation failed:', e);
                    }

                    populateImageContainer(imageData, placeholder, currentPrompt, captionText);

                    // Save to database in the background
                    saveImageToDatabase({
                       base64: base64Image,
                       prompt: currentPrompt,
                       model: selectedModel,
                       caption: captionText,
                    }).catch(err => console.error('DB save failed:', err));

                    return imageData;
                } else {
                    placeholder.innerHTML = `<p class="image-caption">Failed to generate image for prompt: "${currentPrompt}"</p>`;
                    placeholder.classList.remove('loading');
                    return null;
                }
            };
            
            if (diverseSubjectsCheckbox.checked) {
                showIndeterminateProgress('Generating diverse prompts...');
                const diversePrompts = await getDiversePrompts(prompt, numberOfImages);
                
                for (let i = 0; i < diversePrompts.length; i++) {
                    updateProgress(i + 1, diversePrompts.length);
                    const generated = await generateAndProcessImage(diversePrompts[i], placeholders[i] as HTMLDivElement);
                    if (generated) allGeneratedImages.push(generated);
                }
            } else {
                showIndeterminateProgress(`Generating ${numberOfImages} images...`);
                // Generate all images first for single prompt for efficiency
                const response = await ai.models.generateImages({
                    model: selectedModel,
                    prompt: prompt,
                    config: { numberOfImages, outputMimeType: 'image/png', aspectRatio: '1:1' },
                });
                
                if (response.generatedImages && response.generatedImages.length > 0) {
                    allGeneratedImages = response.generatedImages;
                    for (let i=0; i < response.generatedImages.length; i++) {
                        const imageData = response.generatedImages[i];
                        const base64Image = imageData.image.imageBytes;
                        
                        let captionText = 'Caption not available.';
                        try {
                            captionText = await generateCaption(base64Image, prompt);
                        } catch (e) {
                             console.error('Caption generation failed:', e);
                        }
                        
                        populateImageContainer(imageData, placeholders[i] as HTMLDivElement, prompt, captionText);

                        // Save to database in the background
                        saveImageToDatabase({
                           base64: base64Image,
                           prompt: prompt,
                           model: selectedModel,
                           caption: captionText,
                        }).catch(err => console.error('DB save failed:', err));
                    }
                } else {
                    placeholders.forEach(p => {
                        (p as HTMLDivElement).innerHTML = '<p class="image-caption">Failed to generate images.</p>';
                        (p as HTMLDivElement).classList.remove('loading');
                    });
                }
            }
        }

        if (allGeneratedImages.length > 0) {
            addToHistory(prompt, selectedModel, allGeneratedImages[0]);
            totalGeneratedCount += allGeneratedImages.length;
            updateUiCounts(allGeneratedImages.length);
            downloadContainer.classList.remove('hidden');
        } else {
            imageGallery.innerHTML = '<p class="placeholder">Image generation failed to produce results. Please try a different prompt.</p>';
        }

    } catch (e) {
        const error = e as Error;
        console.error(error);
        const errorMessageText = error.message || 'Could not generate images.';
        displayError(errorMessageText);
        imageGallery.innerHTML = '<p class="placeholder">Image generation failed. Please check the console and try again.</p>';
    } finally {
        generateButton.textContent = originalButtonText;
        generateButton.disabled = false;
        hideProgress();
    }
}


async function suggestPrompts() {
    suggestPromptsButton.disabled = true;
    suggestionsContainer.innerHTML = '<p class="loading-suggestions">Getting suggestions... ✨</p>';
    hideError();

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'Suggest 2 creative, visually-rich prompts for an AI image generator for each of the following categories: Fantasy, Sci-Fi, Nature, and Abstract.',
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        "Fantasy": {
                            type: Type.ARRAY,
                            items: { type: Type.STRING, description: 'A creative fantasy-themed prompt.' }
                        },
                        "Sci-Fi": {
                            type: Type.ARRAY,
                            items: { type: Type.STRING, description: 'A creative sci-fi-themed prompt.' }
                        },
                        "Nature": {
                            type: Type.ARRAY,
                            items: { type: Type.STRING, description: 'A creative nature-themed prompt.' }
                        },
                        "Abstract": {
                            type: Type.ARRAY,
                            items: { type: Type.STRING, description: 'A creative abstract-themed prompt.' }
                        }
                    },
                    required: ['Fantasy', 'Sci-Fi', 'Nature', 'Abstract'],
                }
            }
        });

        suggestionsContainer.innerHTML = ''; // Clear loading message
        const result = JSON.parse(response.text);

        for (const category in result) {
            const categoryTitle = document.createElement('h3');
            categoryTitle.textContent = category;
            suggestionsContainer.appendChild(categoryTitle);

            const categoryPrompts = result[category];
            if (Array.isArray(categoryPrompts)) {
                const buttonWrapper = document.createElement('div');
                buttonWrapper.className = 'suggestion-category-wrapper';
                
                categoryPrompts.forEach((prompt: string) => {
                    const button = document.createElement('button');
                    button.textContent = prompt;
                    button.className = 'suggestion-button';
                    button.onclick = () => {
                        promptInput.value = prompt;
                    };
                    buttonWrapper.appendChild(button);
                });
                suggestionsContainer.appendChild(buttonWrapper);
            }
        }
        
        const moreButton = document.createElement('button');
        moreButton.id = 'more-suggestions-button';
        moreButton.textContent = 'More Suggestions';
        moreButton.onclick = suggestPrompts;
        suggestionsContainer.appendChild(moreButton);

    } catch (e) {
        const error = e as Error;
        console.error(e);
        displayError(error.message || 'Could not suggest prompts.');
        suggestionsContainer.innerHTML = ''; // Clear loading on error
    } finally {
        suggestPromptsButton.disabled = false;
    }
}

async function downloadAllImages() {
    const originalButtonText = downloadAllButton.textContent;
    downloadAllButton.textContent = 'Zipping...';
    downloadAllButton.disabled = true;

    try {
        const images = imageGallery.querySelectorAll<HTMLImageElement>('.image-wrapper img');
        if (images.length === 0) {
            displayError('No images to download.');
            return;
        }

        const zip = new JSZip();
        
        images.forEach((img, index) => {
            const base64Data = img.src.split(',')[1];
            zip.file(`image_${index + 1}.png`, base64Data, { base64: true });
        });

        const content = await zip.generateAsync({ type: "blob" });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = `imagen_gallery_${Date.now()}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

    } catch (e) {
        const error = e as Error;
        console.error("Zipping failed:", error);
        displayError(error.message || 'Could not create ZIP file.');
    } finally {
        downloadAllButton.textContent = originalButtonText;
        downloadAllButton.disabled = false;
    }
}

function handleModelChange() {
    const selectedModel = generationModelSelect.value;
    if (selectedModel === 'gemini-2.5-flash-image-preview') {
        numImagesInput.disabled = false;
        diverseSubjectsCheckbox.disabled = false;
        numImagesSetting.classList.remove('disabled');
        diverseSubjectsSetting.classList.remove('disabled');

        modelInfo.textContent = 'Note: Each image will be generated sequentially with this model.';
        modelInfo.classList.remove('hidden');

    } else { // Back to imagen
        numImagesInput.disabled = false;
        diverseSubjectsCheckbox.disabled = false;
        numImagesSetting.classList.remove('disabled');
        diverseSubjectsSetting.classList.remove('disabled');
        modelInfo.classList.add('hidden');
    }
}


// -------------------- EVENT LISTENERS ----------------------------------------------------
if (generateButton) generateButton.addEventListener('click', generateImages);
if (suggestPromptsButton) suggestPromptsButton.addEventListener('click', suggestPrompts);
if (closeErrorButton) closeErrorButton.addEventListener('click', hideError);
if (downloadAllButton) downloadAllButton.addEventListener('click', downloadAllImages);
if (generationModelSelect) generationModelSelect.addEventListener('change', handleModelChange);
if (clearHistoryButton) clearHistoryButton.addEventListener('click', clearHistory);

if (closeGalleryInfoButton) {
    closeGalleryInfoButton.addEventListener('click', () => {
        if (galleryInfoCallout) {
            galleryInfoCallout.style.opacity = '0';
            // Use a timeout to set display:none after the transition
            setTimeout(() => {
                galleryInfoCallout.style.display = 'none';
            }, 400);
        }
        localStorage.setItem(GALLERY_INFO_DISMISSED_KEY, 'true');
    });
}

if (layoutControls) {
    const layoutButtons = layoutControls.querySelectorAll<HTMLButtonElement>('.layout-button');
    layoutButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            layoutButtons.forEach(btn => btn.classList.remove('active'));
            // Add active class to clicked button
            button.classList.add('active');

            const layout = button.dataset.layout;

            // Remove all layout classes from gallery
            imageGallery.classList.remove('layout-comfortable', 'layout-compact', 'layout-single');
            
            // Add the new one
            if (layout) {
                imageGallery.classList.add(`layout-${layout}`);
            }
        });
    });
}

// -------------------- INITIALIZATION -----------------------------------------------------
function initializeApp() {
    if (!imageGallery.innerHTML) {
        imageGallery.innerHTML = '<p class="placeholder">Your generated images will appear here. ✨</p>';
    }
    imageGallery.classList.add('layout-comfortable'); // Set default layout
    updateUiCounts(0); // Initialize counts on load
    loadHistory(); // Load and render history from localStorage

    // Check if the info callout was previously dismissed
    if (localStorage.getItem(GALLERY_INFO_DISMISSED_KEY) === 'true') {
        if (galleryInfoCallout) galleryInfoCallout.style.display = 'none';
    }
}

initializeApp();
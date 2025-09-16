/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, GeneratedImage, Modality, Type} from '@google/genai';
import JSZip from 'jszip';

// Correct API key usage as per guidelines
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

// -------------------- STATE ----------------------------------------------------------------
let totalGeneratedCount = 0;

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

function populateImageContainer(imageData: GeneratedImage, container: HTMLDivElement, imagePrompt: string) {
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
    // SVG icon for download
    downloadButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>`;
    downloadButton.onclick = () => {
        const a = document.createElement('a');
        a.href = img.src;
        a.download = `imagen_gen_${Date.now()}.png`;
        a.click();
    };

    imageWrapper.append(img, downloadButton);

    const caption = document.createElement('p');
    caption.className = 'image-caption';
    caption.textContent = 'Generating caption...';

    container.append(imageWrapper, caption);
    
    img.onload = async () => {
        try {
            const captionText = await generateCaption(base64Image, imagePrompt);
            caption.textContent = captionText;
        } catch (e) {
            console.error('Caption generation failed:', e);
            caption.textContent = 'Could not generate caption.';
        } finally {
            container.classList.remove('loading');
        }
    };
    img.onerror = () => {
        console.error('Image failed to load.');
        container.innerHTML = '<p class="image-caption">Error loading image.</p>';
        container.classList.remove('loading');
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

    for (let i = 0; i < numberOfImages; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'image-container loading';
        imageGallery.appendChild(placeholder);
    }
    const placeholders = Array.from(imageGallery.querySelectorAll('.image-container.loading'));

    try {
        let allGeneratedImages: GeneratedImage[] = [];
        let promptsForImages: string[] = [];

        if (diverseSubjectsCheckbox.checked) {
            showIndeterminateProgress('Generating diverse prompts...');
            const diversePrompts = await getDiversePrompts(promptInput.value, numberOfImages);
            promptsForImages = diversePrompts;
            
            for (let i = 0; i < diversePrompts.length; i++) {
                const currentPrompt = diversePrompts[i];
                updateProgress(i + 1, diversePrompts.length);
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image-preview',
                    contents: { parts: [{ text: currentPrompt }] },
                    config: {
                        responseModalities: [Modality.IMAGE, Modality.TEXT],
                    },
                });

                const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
                if (imagePart?.inlineData) {
                    const imageData = { image: { imageBytes: imagePart.inlineData.data } };
                    allGeneratedImages.push(imageData);
                    if (placeholders[i]) {
                         populateImageContainer(imageData, placeholders[i] as HTMLDivElement, currentPrompt);
                    }
                } else {
                     if (placeholders[i]) {
                        (placeholders[i] as HTMLDivElement).innerHTML = '<p class="image-caption">Failed to generate this image.</p>';
                        (placeholders[i] as HTMLDivElement).classList.remove('loading');
                    }
                }
            }
        } else {
            promptsForImages = Array(numberOfImages).fill(promptInput.value);
            for (let i = 0; i < numberOfImages; i++) {
                updateProgress(i + 1, numberOfImages);
                const currentPrompt = promptsForImages[i];
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image-preview',
                    contents: { parts: [{ text: currentPrompt }] },
                    config: {
                        responseModalities: [Modality.IMAGE, Modality.TEXT],
                    },
                });
                
                const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
                if (imagePart?.inlineData) {
                    const imageData = { image: { imageBytes: imagePart.inlineData.data } };
                    allGeneratedImages.push(imageData);
                    if (placeholders[i]) {
                        populateImageContainer(imageData, placeholders[i] as HTMLDivElement, currentPrompt);
                    }
                } else {
                     if (placeholders[i]) {
                        (placeholders[i] as HTMLDivElement).innerHTML = '<p class="image-caption">Failed to generate this image.</p>';
                        (placeholders[i] as HTMLDivElement).classList.remove('loading');
                    }
                }
            }
        }
        
        totalGeneratedCount += allGeneratedImages.length;
        updateUiCounts(allGeneratedImages.length);

        if (allGeneratedImages.length > 0) {
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

// -------------------- EVENT LISTENERS ----------------------------------------------------
if (generateButton) generateButton.addEventListener('click', generateImages);
if (suggestPromptsButton) suggestPromptsButton.addEventListener('click', suggestPrompts);
if (closeErrorButton) closeErrorButton.addEventListener('click', hideError);
if (downloadAllButton) downloadAllButton.addEventListener('click', downloadAllImages);

// -------------------- INITIALIZATION -----------------------------------------------------
if (!imageGallery.innerHTML) {
    imageGallery.innerHTML = '<p class="placeholder">Your generated images will appear here. ✨</p>';
}
updateUiCounts(0); // Initialize counts on load
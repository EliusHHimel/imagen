/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, GeneratedImage, PersonGeneration, Type} from '@google/genai';
import JSZip from 'jszip';

// Correct API key usage as per guidelines
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

// -------------------- DOM ELEMENTS ---------------------------------------------------------
const imageGallery = document.getElementById('image-gallery') as HTMLDivElement;
const generateButton = document.getElementById('generate-button') as HTMLButtonElement;
const numImagesInput = document.getElementById('number-of-images') as HTMLInputElement;
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const savePromptButton = document.getElementById('save-prompt-button') as HTMLButtonElement;
const suggestPromptsButton = document.getElementById('suggest-prompts-button') as HTMLButtonElement;
const suggestionsContainer = document.getElementById('suggestions-container') as HTMLDivElement;
const allowPeopleCheckbox = document.getElementById('allow-people') as HTMLInputElement;
const diverseSubjectsCheckbox = document.getElementById('diverse-subjects') as HTMLInputElement;
const errorContainer = document.getElementById('error-container') as HTMLDivElement;
const errorMessage = document.getElementById('error-message') as HTMLParagraphElement;
const closeErrorButton = document.getElementById('close-error-button') as HTMLButtonElement;
const downloadContainer = document.getElementById('download-container') as HTMLDivElement;
const downloadAllButton = document.getElementById('download-all-button') as HTMLButtonElement;

// -------------------- LOCAL STORAGE ------------------------------------------------------
const SAVED_PROMPT_KEY = 'savedImagenPrompt';

function loadPrompt() {
    const savedPrompt = localStorage.getItem(SAVED_PROMPT_KEY);
    if (savedPrompt && promptInput) {
        promptInput.value = savedPrompt;
    }
}

function savePrompt() {
    if (promptInput) {
        localStorage.setItem(SAVED_PROMPT_KEY, promptInput.value);
        const originalText = savePromptButton.textContent;
        savePromptButton.textContent = 'Saved!';
        setTimeout(() => {
            savePromptButton.textContent = originalText;
        }, 2000);
    }
}

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
// Fix: Pass the imagePrompt as an argument since GeneratedImage doesn't contain it.
function populateImageContainer(imageData: GeneratedImage, container: HTMLDivElement, imagePrompt: string) {
    const imageWrapper = document.createElement('div');
    imageWrapper.className = 'image-wrapper';

    const img = document.createElement('img');
    const base64Image = imageData.image.imageBytes;
    img.src = `data:image/png;base64,${base64Image}`;
    // Fix: Use the passed imagePrompt for the alt text, as imageData.prompt does not exist.
    img.alt = imagePrompt;

    const downloadButton = document.createElement('button');
    downloadButton.textContent = 'Download';
    downloadButton.className = 'download-button';
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
            // Fix: Use the passed imagePrompt for caption generation, as imageData.prompt does not exist.
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

    const numberOfImages = parseInt(numImagesInput.value, 10);

    for (let i = 0; i < numberOfImages; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'image-container loading';
        imageGallery.appendChild(placeholder);
    }
    const placeholders = Array.from(imageGallery.querySelectorAll('.image-container.loading'));

    try {
        const personGenerationSetting = allowPeopleCheckbox.checked ?
            PersonGeneration.ALLOW_ADULT : PersonGeneration.DONT_ALLOW;
        
        let allGeneratedImages: GeneratedImage[] = [];
        // Fix: Store prompts to pass them to populateImageContainer, as GeneratedImage doesn't contain the prompt.
        let promptsForImages: string[] = [];

        if (diverseSubjectsCheckbox.checked) {
            const diversePrompts = await getDiversePrompts(promptInput.value, numberOfImages);
            promptsForImages = diversePrompts;
            const imagePromises = diversePrompts.map(prompt => 
                ai.models.generateImages({
                    model: 'imagen-4.0-generate-001',
                    prompt: prompt,
                    config: {
                        numberOfImages: 1,
                        outputMimeType: 'image/png',
                        personGeneration: personGenerationSetting,
                    },
                })
            );
            const responses = await Promise.all(imagePromises);
            responses.forEach(response => allGeneratedImages.push(...response.generatedImages));
        } else {
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: promptInput.value,
                config: {
                    numberOfImages: numberOfImages,
                    outputMimeType: 'image/png',
                    personGeneration: personGenerationSetting,
                },
            });
            allGeneratedImages = response.generatedImages;
            promptsForImages = Array(allGeneratedImages.length).fill(promptInput.value);
        }

        if (allGeneratedImages.length > 0) {
            allGeneratedImages.forEach((imageData, index) => {
                if (placeholders[index]) {
                    // Fix: Pass the corresponding prompt to populateImageContainer.
                    populateImageContainer(imageData, placeholders[index] as HTMLDivElement, promptsForImages[index]);
                }
            });
            downloadContainer.classList.remove('hidden');
        } else {
            imageGallery.innerHTML = '<p class="placeholder">Image generation failed to produce results. Please try a different prompt.</p>';
        }

    } catch (e) {
        const error = e as Error;
        console.error(error);
        displayError(error.message || 'Could not generate images.');
        imageGallery.innerHTML = '<p class="placeholder">Image generation failed. Please check the console and try again.</p>';
    } finally {
        generateButton.textContent = originalButtonText;
        generateButton.disabled = false;
    }
}


async function suggestPrompts() {
    const originalButtonText = suggestPromptsButton.textContent;
    suggestPromptsButton.textContent = 'Thinking...';
    suggestPromptsButton.disabled = true;
    suggestionsContainer.innerHTML = '';
    hideError();

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'Suggest 4 creative, visually-rich, and diverse prompts for an AI image generator. The prompts should be about different subjects and styles.',
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
        if (result.prompts && Array.isArray(result.prompts)) {
            result.prompts.forEach((prompt: string) => {
                const button = document.createElement('button');
                button.textContent = prompt;
                button.className = 'suggestion-button';
                button.onclick = () => {
                    promptInput.value = prompt;
                };
                suggestionsContainer.appendChild(button);
            });
        }
    } catch (e) {
        const error = e as Error;
        console.error(e);
        displayError(error.message || 'Could not suggest prompts.');
    } finally {
        suggestPromptsButton.textContent = originalButtonText;
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
if (savePromptButton) savePromptButton.addEventListener('click', savePrompt);
if (suggestPromptsButton) suggestPromptsButton.addEventListener('click', suggestPrompts);
if (closeErrorButton) closeErrorButton.addEventListener('click', hideError);
if (downloadAllButton) downloadAllButton.addEventListener('click', downloadAllImages);

// -------------------- INITIALIZATION -----------------------------------------------------
loadPrompt();

if (!imageGallery.innerHTML) {
    imageGallery.innerHTML = '<p class="placeholder">Your generated images will appear here. ✨</p>';
}

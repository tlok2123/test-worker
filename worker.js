const WATERMARK_OPTIONS = "position=bottom%2Cright&opacity=1&scale=1"; // Watermark settings: bottom-right, 70% opacity, 20% scale

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        // Handle CORS Preflight (OPTIONS request)
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }

        // Handle image upload (POST request to '/upload-image')
        if (request.method === 'POST' && url.pathname === '/upload-image') {
            try {
                headers['Content-Type'] = 'application/json';

                // Validate environment variables
                if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_DELIVERY_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
                    throw new Error('Missing Cloudflare Images environment variables (ACCOUNT_ID, DELIVERY_ACCOUNT_ID, API_TOKEN)');
                }
                if (!env.test_togihome || !env.R2_ACCOUNT_ID) {
                    throw new Error('Missing R2 environment variables (R2_ACCOUNT_ID or test_togihome binding)');
                }

                // Parse form data
                const formData = await request.formData();
                const imageFile = formData.get('image');
                const type = formData.get('type');

                if (!imageFile) {
                    throw new Error('No image file found in form-data');
                }
                if (!type || type !== 'product') {
                    throw new Error('Invalid or missing type field');
                }

                // Retrieve watermark URL from R2 bucket
                let r2WatermarkUrl = null;
                try {
                    const watermarkObject = await env.test_togihome.get('anh5.png');
                    if (!watermarkObject) {
                        throw new Error('Watermark anh5.png not found in test-togihome R2 bucket');
                    }
                    r2WatermarkUrl = `https://pub-${env.R2_ACCOUNT_ID}.r2.dev/anh5.png`;
                    console.log('Watermark URL from R2:', r2WatermarkUrl);
                } catch (r2Error) {
                    console.error('Error accessing R2 for watermark:', r2Error.message);
                    // Continue without watermark if R2 fails
                }

                // Prepare form data for Cloudflare Images API
                const uploadFormData = new FormData();
                uploadFormData.append('file', imageFile);
                uploadFormData.append('metadata', JSON.stringify({ type }));
                uploadFormData.append('requireSignedURLs', 'false');

                // Upload image to Cloudflare Images
                const imageUploadResponse = await fetch(
                    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/images/v1`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
                        },
                        body: uploadFormData,
                    }
                );

                const imageResult = await imageUploadResponse.json();
                if (!imageResult.success) {
                    throw new Error(`Upload failed: ${imageResult.errors[0]?.message || 'Unknown error'}`);
                }

                const imageId = imageResult.result.id;

                // Generate watermarked URLs
                const baseDeliveryUrl = `https://imagedelivery.net/${env.CLOUDFLARE_DELIVERY_ACCOUNT_ID}/${imageId}`;
                let fullUrlWithWatermark = `${baseDeliveryUrl}/productfull`;
                let thumbUrlWithWatermark = `${baseDeliveryUrl}/productthumb`;

                if (r2WatermarkUrl) {
                    const encodedWatermarkUrl = encodeURIComponent(r2WatermarkUrl);
                    fullUrlWithWatermark = `${fullUrlWithWatermark}?watermark=${encodedWatermarkUrl}&watermark_options=${WATERMARK_OPTIONS}`;
                    thumbUrlWithWatermark = `${thumbUrlWithWatermark}?watermark=${encodedWatermarkUrl}&watermark_options=${WATERMARK_OPTIONS}`;
                } else {
                    console.warn('Unable to generate watermarked URLs due to missing or invalid R2 watermark.');
                }

                // Return success response with image URLs
                return new Response(
                    JSON.stringify({
                        message: 'Upload successful',
                        fileName: imageFile.name,
                        imageId,
                        fullUrlWatermarked: fullUrlWithWatermark,
                        thumbUrlWatermarked: thumbUrlWithWatermark,
                    }),
                    {
                        status: 200,
                        headers,
                    }
                );
            } catch (error) {
                console.error('Error uploading image:', error.message);
                return new Response(JSON.stringify({ error: error.message }), {
                    status: 500,
                    headers: { ...headers, 'Content-Type': 'application/json' },
                });
            }
        }

        // Handle watermarking for direct image requests (GET request to imagedelivery.net)
        if (request.method === 'GET' && url.hostname === 'imagedelivery.net') {
            const pathParts = url.pathname.split('/');

            if (pathParts.length >= 3 && pathParts[1] === env.CLOUDFLARE_DELIVERY_ACCOUNT_ID) {
                let r2WatermarkUrl;
                try {
                    const watermarkObject = await env.test_togihome.get('togihome-watermark-origin.png');
                    if (!watermarkObject) {
                        console.warn('Watermark file not found in R2 for GET request. Serving image without watermark.');
                        return fetch(request);
                    }
                    r2WatermarkUrl = `https://pub-${env.R2_ACCOUNT_ID}.r2.dev/togihome-watermark-origin.png`;
                } catch (r2Error) {
                    console.error('Error accessing R2 for watermark (GET request):', r2Error.message);
                    return fetch(request);
                }

                const baseUrl = `https://${url.hostname}/${pathParts[1]}/${pathParts[2]}`;
                const variantPath = pathParts.length > 3 ? `/${pathParts.slice(3).join('/')}` : '';

                // Avoid duplicate watermark parameters
                if (!url.searchParams.has('watermark') && !url.searchParams.has('watermark_options')) {
                    const encodedWatermarkUrl = encodeURIComponent(r2WatermarkUrl);
                    const newImageUrl = `${baseUrl}${variantPath}?watermark=${encodedWatermarkUrl}&watermark_options=${WATERMARK_OPTIONS}`;
                    console.log('Transformed Image Request URL with watermark (GET):', newImageUrl);
                    const newRequest = new Request(newImageUrl, request);
                    return fetch(newRequest);
                }
            }
        }

        // Handle unmatched requests
        return new Response('Endpoint Not Found or Unsupported Method', { status: 404 });
    },
};
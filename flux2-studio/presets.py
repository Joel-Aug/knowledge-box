"""Preset prompt templates.

Text inside [square brackets] is meant to be replaced by the user.
`aspect` is the aspect ratio the UI switches to when the preset is picked.
"""

PRESETS = [
    {
        "id": "exterior",
        "name": "Photoreal exterior",
        "aspect": "3:2",
        "prompt": (
            "Photorealistic architectural exterior photograph of a [modern two-storey house "
            "with timber cladding and large glazing], set in [a lush garden with mature trees]. "
            "Golden-hour sunlight, soft long shadows, clear sky with a few clouds. "
            "Shot on a full-frame camera with a 24mm tilt-shift lens, eye-level perspective, "
            "straight verticals, high dynamic range, crisp material detail, "
            "professional architectural photography, magazine quality."
        ),
    },
    {
        "id": "interior",
        "name": "Interior render",
        "aspect": "16:9",
        "prompt": (
            "High-end interior design render of a [spacious open-plan living room and kitchen] "
            "in [Scandinavian minimalist] style. [Light oak floors, white plaster walls, "
            "linen sofa, marble kitchen island]. Soft natural daylight from floor-to-ceiling "
            "windows, subtle global illumination, realistic textures and reflections, "
            "styled with plants and books, wide-angle 20mm view, V-Ray / Corona render quality, "
            "photorealistic."
        ),
    },
    {
        "id": "iso-floorplan",
        "name": "Isometric 3D floor plan",
        "aspect": "4:3",
        "prompt": (
            "Isometric 3D cutaway floor plan of a [two-bedroom apartment with open kitchen, "
            "living room, bathroom and balcony]. Roof removed, walls cut at waist height, "
            "fully furnished rooms with miniature furniture, wooden and tiled floors, "
            "soft ambient occlusion lighting, clean white background, "
            "45-degree isometric camera, tidy architectural visualization, "
            "dollhouse diorama style, high detail."
        ),
    },
    {
        "id": "topdown-floorplan",
        "name": "Top-down colored floor plan",
        "aspect": "1:1",
        "prompt": (
            "Top-down 2D colored architectural floor plan of a [three-bedroom single-storey "
            "house with living room, kitchen, dining area, two bathrooms and a garage]. "
            "Orthographic view from directly above, clean black wall lines, "
            "each room filled with a soft distinct pastel color, furniture symbols in plan view, "
            "door swings and windows drawn, clear room labels, flat graphic style, "
            "white background, professional real-estate marketing floor plan."
        ),
    },
]

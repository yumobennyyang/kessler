import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get("url");
    if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ error: "Failed to fetch video" }, { status: 502 });

    const filename = url.split("/").pop()?.split("?")[0] || "video.mp4";
    const headers = new Headers({
        "Content-Type": res.headers.get("Content-Type") || "video/mp4",
        "Content-Disposition": `attachment; filename="${filename}"`,
    });
    const contentLength = res.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new NextResponse(res.body, { headers });
}

import {canLearn} from '@/lib/membership';
import {eq} from 'drizzle-orm';
import {getDb,getMediaBucket} from '@/db';
import {videoLessons} from '@/db/schema';
import {isAdmin} from '@/lib/admin';
import {mediaResponse} from '@/lib/media-response';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params,lesson=await getDb().select().from(videoLessons).where(eq(videoLessons.id,id)).get();if(!lesson?.mediaKey||(lesson.status!=='published'&&!await isAdmin()))return new Response('Not found',{status:404});if(!await canLearn('video',id))return new Response('Membership required',{status:403});return mediaResponse(getMediaBucket(),lesson.mediaKey,lesson.mimeType,request,{cacheControl:'private, max-age=300, must-revalidate'})}catch{return new Response('Media temporarily unavailable',{status:503})}}
export const HEAD=GET;

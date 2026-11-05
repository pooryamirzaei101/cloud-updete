import {and,asc,desc,eq,gt,ilike,isNull,lte,or,sql} from 'drizzle-orm';
import {getDb} from '@/db';
import {learnerProfiles,memberships,premiumGrants,userAdminAudit} from '@/db/schema';
import {isAdmin} from '@/lib/admin';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {countries,countryName,learnerLevels,learningPurposes,safeCsvCell} from '@/lib/profile-options';
import {syncAuthUsersForAdmin} from '@/lib/admin-auth-users';
export async function GET(request:Request){
 if(!await isAdmin())return Response.json({error:'Administrator access required.'},{status:403});
 try{await syncAuthUsersForAdmin();const q=new URL(request.url).searchParams,db=getDb(),now=Date.now(),search=(q.get('search')||'').trim().slice(0,150),plan=q.get('plan')||'all',country=q.get('country')||'',level=q.get('level')||'',purpose=q.get('purpose')||'',newsletter=q.get('newsletter')||'all',profile=q.get('profile')||'all';
 if(!['all','free','premium'].includes(plan)||!['all','yes','no'].includes(newsletter)||!['all','complete','incomplete'].includes(profile)||country&&!Object.hasOwn(countries,country)||level&&!Object.hasOwn(learnerLevels,level)||purpose&&!Object.hasOwn(learningPurposes,purpose))return Response.json({error:'Choose valid user filters.'},{status:400});
 const effective=sql<number>`GREATEST(COALESCE(${memberships.expiresAt},0),COALESCE(${premiumGrants.expiresAt},0))`;
 const filters=[];if(search)filters.push(or(ilike(learnerProfiles.email,`%${search}%`),ilike(learnerProfiles.displayName,`%${search}%`)));
 if(plan==='premium')filters.push(gt(effective,now));if(plan==='free')filters.push(lte(effective,now));
 if(country)filters.push(eq(learnerProfiles.country,country));if(level)filters.push(eq(learnerProfiles.level,level));if(purpose)filters.push(eq(learnerProfiles.purpose,purpose));if(newsletter!=='all')filters.push(eq(learnerProfiles.newsletterConsent,newsletter==='yes'?1:0));if(profile!=='all')filters.push(profile==='complete'?sql`${learnerProfiles.completedAt} IS NOT NULL`:isNull(learnerProfiles.completedAt));
 const exporting=q.get('export')==='newsletter';if(exporting)filters.push(eq(learnerProfiles.newsletterConsent,1));
 const where=and(...filters),rawPage=Number(q.get('page')||1);if(!Number.isSafeInteger(rawPage)||rawPage<1||rawPage>100000)return Response.json({error:'Choose a valid page.'},{status:400});
 const count=Number((await db.select({value:sql<number>`COUNT(*)`}).from(learnerProfiles).leftJoin(memberships,eq(learnerProfiles.userId,memberships.userId)).leftJoin(premiumGrants,eq(learnerProfiles.userId,premiumGrants.userId)).where(where).get())?.value||0);
 if(exporting&&count>10000)return Response.json({error:'More than 10,000 contacts match. Narrow the filters and export each group separately.'},{status:413});
 const page=Math.min(rawPage,Math.max(1,Math.ceil(count/25))),identity=await getChatGPTUser();
 const rows=await db.select({userId:learnerProfiles.userId,email:learnerProfiles.email,name:learnerProfiles.displayName,country:learnerProfiles.country,level:learnerProfiles.level,purpose:learnerProfiles.purpose,newsletterConsent:learnerProfiles.newsletterConsent,newsletterConsentAt:learnerProfiles.newsletterConsentAt,completedAt:learnerProfiles.completedAt,createdAt:learnerProfiles.createdAt,lastSeenAt:learnerProfiles.lastSeenAt,expiresAt:effective,paidExpiresAt:memberships.expiresAt,grantedExpiresAt:premiumGrants.expiresAt,isPending:learnerProfiles.isPending}).from(learnerProfiles).leftJoin(memberships,eq(learnerProfiles.userId,memberships.userId)).leftJoin(premiumGrants,eq(learnerProfiles.userId,premiumGrants.userId)).where(where).orderBy(q.get('sort')==='oldest'?asc(learnerProfiles.createdAt):desc(learnerProfiles.createdAt),asc(learnerProfiles.userId)).limit(exporting?10000:25).offset(exporting?0:(page-1)*25).all();
 const formatted=rows.map(row=>({...row,plan:row.expiresAt&&row.expiresAt>now?'Premium':'Free',role:identity&&row.email.toLowerCase()===identity.email.toLowerCase()?'Administrator':'Student'}));
 if(exporting){const headings=['Name','Email','Country','English level','Learning purpose','Plan','Newsletter preference updated (UTC)'],lines=formatted.map(r=>[r.name,r.email,countryName(r.country),learnerLevels[r.level as keyof typeof learnerLevels]||'Not provided',learningPurposes[r.purpose as keyof typeof learningPurposes]||'Not provided',r.plan,r.newsletterConsentAt?new Date(r.newsletterConsentAt).toISOString():'']);return new Response('\uFEFF'+[headings,...lines].map(line=>line.map(safeCsvCell).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="lingolive-newsletter-contacts.csv"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
 const rawStats=await db.select({total:sql<number>`COUNT(*)`,premium:sql<number>`COALESCE(SUM(CASE WHEN ${effective}>${now} THEN 1 ELSE 0 END),0)`,newsletter:sql<number>`COALESCE(SUM(${learnerProfiles.newsletterConsent}),0)`,incomplete:sql<number>`COALESCE(SUM(CASE WHEN ${learnerProfiles.completedAt} IS NULL THEN 1 ELSE 0 END),0)`}).from(learnerProfiles).leftJoin(memberships,eq(learnerProfiles.userId,memberships.userId)).leftJoin(premiumGrants,eq(learnerProfiles.userId,premiumGrants.userId)).get(),stats={total:Number(rawStats?.total||0),premium:Number(rawStats?.premium||0),newsletter:Number(rawStats?.newsletter||0),incomplete:Number(rawStats?.incomplete||0)};
 return Response.json({users:formatted,total:count,page,pages:Math.max(1,Math.ceil(count/25)),stats:{...stats,free:stats.total-stats.premium}},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){console.error('Could not load administrator user records.',error);return Response.json({error:'User records are temporarily unavailable. Please try again.'},{status:503})}
}

export async function POST(request:Request){
 if(!await isAdmin())return Response.json({error:'Administrator access required.'},{status:403});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin.'},{status:403});
 const actor=await getChatGPTUser();if(!actor)return Response.json({error:'Sign in as the administrator.'},{status:401});
 try{const body=await request.json() as any,db=getDb(),now=Date.now();
 const validExpiry=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>now&&value<=now+10*366*86400000;
 if(body.action==='add'){
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'',name=typeof body.name==='string'?body.name.trim():'';
 if(!name||name.length>100||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['free','premium'].includes(body.plan))return Response.json({error:'Enter a name, a valid email, and an initial plan.'},{status:400});
 if(body.plan==='premium'&&!validExpiry(body.expiresAt))return Response.json({error:'Choose a future Premium end date within ten years.'},{status:400});
 if(await db.select({id:learnerProfiles.userId}).from(learnerProfiles).where(sql`LOWER(${learnerProfiles.email})=${email}`).get())return Response.json({error:'This email is already listed. Use Manage Premium beside that user.'},{status:409});
 const id=`pending:${crypto.randomUUID()}`,expiry=body.plan==='premium'?body.expiresAt:null;
 try{await db.transaction(async(tx:any)=>{await tx.insert(learnerProfiles).values({userId:id,isPending:1,pendingEmail:email,email,displayName:name,createdAt:now,updatedAt:now,lastSeenAt:0});await tx.insert(userAdminAudit).values({id:crypto.randomUUID(),actorId:actor.userId,targetId:id,action:'user_added',expiresAt:expiry,createdAt:now});if(expiry)await tx.insert(premiumGrants).values({userId:id,expiresAt:expiry,grantedBy:actor.userId,updatedAt:now})})}catch(error){if(await db.select({id:learnerProfiles.userId}).from(learnerProfiles).where(eq(learnerProfiles.pendingEmail,email)).get())return Response.json({error:'This email is already listed. Use Manage Premium beside that user.'},{status:409});throw error}
 return Response.json({message:'User added. Their record and any granted access will connect when they sign in with this email. No invitation email was sent.',userId:id},{status:201});
 }
 if(!['grant','revoke'].includes(body.action)||typeof body.userId!=='string'||body.userId.length>150)return Response.json({error:'Choose a user and an access action.'},{status:400});
 const target=await db.select().from(learnerProfiles).where(eq(learnerProfiles.userId,body.userId)).get();if(!target)return Response.json({error:'User not found. Refresh the list.'},{status:404});
 if(target.email.toLowerCase()===actor.email.toLowerCase())return Response.json({error:'The administrator already has full access. Choose a student.'},{status:400});
 if(body.action==='grant'){
 if(!validExpiry(body.expiresAt))return Response.json({error:'Choose a future Premium end date within ten years.'},{status:400});
 await db.transaction(async(tx:any)=>{await tx.insert(premiumGrants).values({userId:target.userId,expiresAt:body.expiresAt,grantedBy:actor.userId,updatedAt:now}).onConflictDoUpdate({target:premiumGrants.userId,set:{expiresAt:body.expiresAt,grantedBy:actor.userId,updatedAt:now}});await tx.insert(userAdminAudit).values({id:crypto.randomUUID(),actorId:actor.userId,targetId:target.userId,action:'premium_granted',expiresAt:body.expiresAt,createdAt:now})});
 if(!await db.select({id:learnerProfiles.userId}).from(learnerProfiles).where(eq(learnerProfiles.userId,target.userId)).get())return Response.json({error:'This pending user just signed in. Refresh the list and manage their active account.'},{status:409});
 return Response.json({message:'Premium access granted. The student can open all premium lessons until the selected date.'});
 }
 if(body.confirm!==true)return Response.json({error:'Confirm removal of administrator-granted access.'},{status:400});
 await db.transaction(async(tx:any)=>{await tx.delete(premiumGrants).where(eq(premiumGrants.userId,target.userId));await tx.insert(userAdminAudit).values({id:crypto.randomUUID(),actorId:actor.userId,targetId:target.userId,action:'premium_grant_removed',createdAt:now})});
 return Response.json({message:'Administrator-granted Premium removed. Paid subscription access and saved learning are kept.'});
 }catch(error){console.error('Could not save administrator user change.',error);return Response.json({error:'The user change could not be saved. Refresh the list and try again.'},{status:503})}
}

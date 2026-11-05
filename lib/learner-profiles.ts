import {and,eq,sql} from 'drizzle-orm';
import {getDb} from '@/db';
import {learnerProfiles,premiumGrants,userAdminAudit} from '@/db/schema';
import type {ChatGPTUser} from '@/app/chatgpt-auth';
import {captureNewSignup} from '@/lib/referrals';
export async function syncLearnerProfile(user:ChatGPTUser){
 const db=getDb(),now=Date.now(),email=user.email.trim().toLowerCase();
 let profile=await db.select().from(learnerProfiles).where(eq(learnerProfiles.userId,user.userId)).get();
 if(!profile){const inserted=await db.insert(learnerProfiles).values({userId:user.userId,email:user.email,displayName:user.displayName,createdAt:now,updatedAt:now,lastSeenAt:now}).onConflictDoNothing().returning();profile=await db.select().from(learnerProfiles).where(eq(learnerProfiles.userId,user.userId)).get();if(inserted.length)await captureNewSignup(user.userId,user.email)}
 if(!profile)throw Error('Your profile could not be created. Please try again.');
 const pending=await db.select().from(learnerProfiles).where(eq(learnerProfiles.pendingEmail,email)).get();
 if(pending?.isPending&&pending.userId!==user.userId){
 // The verified email is the claim key. Deleting with RETURNING makes one
 // transaction the winner if two first-page requests arrive together.
 await db.transaction(async(tx:any)=>{
 const grant=await tx.select().from(premiumGrants).where(eq(premiumGrants.userId,pending.userId)).then((rows:any[])=>rows[0]);
 const claimed=await tx.delete(learnerProfiles).where(and(eq(learnerProfiles.userId,pending.userId),eq(learnerProfiles.isPending,1),eq(learnerProfiles.pendingEmail,email))).returning();
 if(!claimed.length)return;
 const current=await tx.select().from(learnerProfiles).where(eq(learnerProfiles.userId,user.userId)).then((rows:any[])=>rows[0]);
 if(current)await tx.update(learnerProfiles).set({country:current.country||pending.country,level:current.level||pending.level,purpose:current.purpose||pending.purpose,createdAt:Math.min(current.createdAt,pending.createdAt),updatedAt:now}).where(eq(learnerProfiles.userId,user.userId));
 if(grant)await tx.insert(premiumGrants).values({userId:user.userId,expiresAt:grant.expiresAt,grantedBy:grant.grantedBy,updatedAt:now}).onConflictDoUpdate({target:premiumGrants.userId,set:{expiresAt:sql`GREATEST(${premiumGrants.expiresAt},${grant.expiresAt})`,grantedBy:grant.grantedBy,updatedAt:now}});
 await tx.delete(premiumGrants).where(eq(premiumGrants.userId,pending.userId));
 await tx.insert(userAdminAudit).values({id:crypto.randomUUID(),actorId:user.userId,targetId:user.userId,action:'pending_account_linked',createdAt:now});
 });
 profile=await db.select().from(learnerProfiles).where(eq(learnerProfiles.userId,user.userId)).get();if(!profile)throw Error('Profile could not load.');
 }
 const changedEmail=profile.email!==user.email;
 if(changedEmail||profile.displayName!==user.displayName||now-profile.lastSeenAt>900000){const values={email:user.email,displayName:user.displayName,lastSeenAt:now,...(changedEmail?{newsletterConsent:0,newsletterConsentAt:null}: {})};await db.update(learnerProfiles).set(values).where(eq(learnerProfiles.userId,user.userId));profile={...profile,...values}}
 return profile;
}

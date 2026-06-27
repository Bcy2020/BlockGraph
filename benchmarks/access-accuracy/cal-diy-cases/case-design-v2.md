# Cal.com DIY Benchmark Cases v2

## 修正说明

基于 BlockGraph DB 实际数据修正：
- 使用实际存在的文件路径（非目录）
- 使用实际存在的实体名
- 确保 block 映射正确

## Cases

### 1. booking-created-notification (bug_localization)

**Task**: When a booking is created, the confirmation email is not sent. The booking is saved to the database correctly, but the user never receives the notification. Where should an agent inspect first?

**Golden**:
- Files: `packages/features/bookings/lib/createBooking.ts`, `packages/features/notifications/sendNotification.ts`
- Entities: `createBooking.ts`, `sendNotification.ts`
- Blocks: `Bookings`, `Notifications`

### 2. event-type-not-found (bug_localization)

**Task**: Users report that some event types return 404 even though they exist in the database. The issue seems related to how event types are fetched for team events. Where is the likely bug?

**Golden**:
- Files: `packages/features/eventtypes/lib/getPublicEvent.ts`, `packages/features/eventtypes/lib/getEventTypesPublic.ts`
- Entities: `getPublicEvent.ts`, `getEventTypesPublic`
- Blocks: `Event Types`

### 3. calendar-sync-failure (bug_localization)

**Task**: Google Calendar events are not syncing correctly. The API returns success but events don't appear in Cal.com. Where should the agent look?

**Golden**:
- Files: `packages/app-store/googlecalendar/lib/CalendarService.ts`, `packages/features/calendars/lib/CalendarManager.ts`
- Entities: `CalendarService.ts`, `CalendarManager.ts`
- Blocks: `Calendars`

### 4. availability-override (bug_localization)

**Task**: When a user sets override availability for a specific date, the override is ignored and the default schedule is used instead. Where is the bug?

**Golden**:
- Files: `packages/features/availability/lib/getUserAvailability.ts`, `packages/features/availability/lib/getAggregatedAvailability.ts`
- Entities: `getUserAvailability.ts`, `getAggregatedAvailability.ts`
- Blocks: `Availability`

### 5. booking-conflict-check (bug_localization)

**Task**: Two users can book the same time slot simultaneously, creating double bookings. The conflict check seems to have a race condition. Where is the bug?

**Golden**:
- Files: `packages/features/bookings/lib/checkForConflicts.ts`, `packages/features/bookings/lib/createBooking.ts`
- Entities: `checkForConflicts`, `createBooking.ts`
- Blocks: `Bookings`

### 6. email-not-sent (bug_localization)

**Task**: Users report not receiving booking confirmation emails. The booking succeeds but no email is delivered. Where should the agent look?

**Golden**:
- Files: `packages/features/notifications/email-manager.ts`, `packages/features/bookings/lib/handleConfirmation.ts`
- Entities: `email-manager.ts`, `handleConfirmation`
- Blocks: `Notifications`, `Bookings`

### 7. add-recurring-event (feature_landing_zone)

**Task**: A new feature needs to be added to support recurring events (e.g., weekly meetings). Where should the new code be inserted?

**Golden**:
- Files: `packages/features/eventtypes/lib/EventTypeService.ts`, `packages/features/eventtypes/lib/eventTypeRepository.ts`
- Entities: `EventTypeService`, `EventTypeRepository`
- Blocks: `Event Types`

### 8. add-team-availability (feature_landing_zone)

**Task**: Add a feature that allows team admins to view and manage team member availability in one place. Where should this be implemented?

**Golden**:
- Files: `packages/features/availability/lib/ScheduleService.ts`, `packages/features/availability/lib/ScheduleRepository.ts`
- Entities: `ScheduleService.ts`, `ScheduleRepository.ts`
- Blocks: `Availability`

### 9. add-booking-embed (feature_landing_zone)

**Task**: Add support for embedding the booking flow in external websites via iframe. Where should the new embed component be added?

**Golden**:
- Files: `packages/embeds/embed-core/src/embed.ts`, `packages/embeds/embed-react/src/`
- Entities: `embed.ts`, `useEmbed`
- Blocks: `Embed`

### 10. add-payment-integration (feature_landing_zone)

**Task**: Add Stripe payment integration for paid bookings. Where should the payment logic be inserted?

**Golden**:
- Files: `packages/app-store/stripepayment/lib/PaymentService.ts`, `packages/features/bookings/lib/createBooking.ts`
- Entities: `PaymentService.ts`, `createBooking.ts`
- Blocks: `Bookings`

### 11. add-webhook-notifications (feature_landing_zone)

**Task**: Add webhook support so external services can receive booking notifications. Where should the webhook dispatch logic be added?

**Golden**:
- Files: `packages/features/notifications/WebhookService.ts`, `packages/features/notifications/sendPayload.ts`
- Entities: `WebhookService`, `sendPayload.ts`
- Blocks: `Notifications`

### 12. auth-token-impact (impact_analysis)

**Task**: The authentication token format is being changed from JWT to opaque tokens. Which files and modules will be affected?

**Golden**:
- Files: `packages/features/auth/lib/next-auth-options.ts`, `packages/features/auth/lib/getServerSession.ts`, `packages/trpc/server/createContext.ts`
- Entities: `next-auth-options.ts`, `getServerSession.ts`, `createContext.ts`
- Blocks: `Authentication`, `tRPC API Layer`

### 13. booking-model-change (impact_analysis)

**Task**: The Booking model needs to add a new `status` field. What other files will need to be updated?

**Golden**:
- Files: `packages/features/bookings/lib/createBooking.ts`, `packages/features/bookings/lib/BookingRepository.ts`, `packages/features/bookings/lib/handleConfirmation.ts`
- Entities: `createBooking.ts`, `BookingRepository`, `handleConfirmation`
- Blocks: `Bookings`

### 14. api-middleware-change (impact_analysis)

**Task**: The tRPC session middleware is being refactored. Which modules will be affected?

**Golden**:
- Files: `packages/trpc/server/sessionMiddleware.ts`, `packages/trpc/server/authedProcedure.ts`, `packages/trpc/server/createContext.ts`
- Entities: `sessionMiddleware.ts`, `authedProcedure.ts`, `createContext.ts`
- Blocks: `tRPC API Layer`

### 15. calendar-provider-change (impact_analysis)

**Task**: The Google Calendar API is being upgraded from v3 to v4. Which files need to be updated?

**Golden**:
- Files: `packages/features/calendars/lib/CalendarManager.ts`, `packages/features/calendars/lib/getCalendarsEvents.ts`
- Entities: `CalendarManager.ts`, `getCalendarsEvents.ts`
- Blocks: `Calendars`

### 16. booking-creation-flow (cross_module_flow)

**Task**: Trace the complete flow of creating a booking, from API call to database save. What are the key files and functions involved?

**Golden**:
- Files: `packages/features/bookings/lib/createBooking.ts`, `packages/features/bookings/lib/checkForConflicts.ts`, `packages/features/bookings/lib/handleConfirmation.ts`
- Entities: `createBooking.ts`, `checkForConflicts`, `handleConfirmation`
- Blocks: `Bookings`

### 17. auth-to-trpc-flow (cross_module_flow)

**Task**: Trace the flow from user authentication to making a tRPC API call. What are the key steps?

**Golden**:
- Files: `packages/features/auth/lib/getServerSession.ts`, `packages/trpc/server/createContext.ts`, `packages/trpc/server/sessionMiddleware.ts`
- Entities: `getServerSession.ts`, `createContext.ts`, `sessionMiddleware.ts`
- Blocks: `Authentication`, `tRPC API Layer`

### 18. event-type-creation-flow (cross_module_flow)

**Task**: Trace the complete flow of creating a new event type, from UI to database. What are the key files?

**Golden**:
- Files: `packages/features/eventtypes/lib/EventTypeService.ts`, `packages/features/eventtypes/lib/eventTypeRepository.ts`, `packages/features/eventtypes/components/CreateEventTypeForm.tsx`
- Entities: `EventTypeService`, `EventTypeRepository`, `CreateEventTypeForm`
- Blocks: `Event Types`

### 19. embed-loading-flow (cross_module_flow)

**Task**: Trace how the embed widget loads and initializes. What are the key files and functions?

**Golden**:
- Files: `packages/embeds/embed-core/src/embed.ts`, `packages/embeds/embed-core/src/embed-iframe.ts`, `packages/embeds/embed-react/src/`
- Entities: `embed.ts`, `embed-iframe.ts`, `useEmbed`
- Blocks: `Embed`

### 20. notification-delivery-flow (cross_module_flow)

**Task**: Trace the flow of how a booking notification is delivered to the user. What are the key steps?

**Golden**:
- Files: `packages/features/notifications/sendNotification.ts`, `packages/features/notifications/email-manager.ts`, `packages/features/notifications/sendPayload.ts`
- Entities: `sendNotification.ts`, `email-manager.ts`, `sendPayload.ts`
- Blocks: `Notifications`

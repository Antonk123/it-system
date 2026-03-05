# 📝 IT Template Setup Instructions

This guide will help you populate your IT ticket system with comprehensive, ready-to-use templates.

## 🎯 What You're Getting

**7 Professional Templates** with **43 Dynamic Fields** covering common IT scenarios:

1. **Allmän IT-Support** (General IT Support) - 6 fields
2. **Behörighetsförfrågan** (Access Request) - 7 fields
3. **Programvaruinstallation** (Software Installation) - 7 fields
4. **Lösenordsåterställning** (Password Reset) - 5 fields
5. **Nätverksproblem** (Network Issue) - 6 fields
6. **Utrustningsretur / Avslut** (Equipment Return / Offboarding) - 7 fields
7. **Skrivarproblem** (Printer Issue) - 5 fields

## 🚀 Quick Start

### Option 1: Run in Docker (Recommended)

```bash
# For production environment (port 3002)
docker exec it-ticketing-backend npm run seed-templates

# For dev environment (port 3003)
docker exec it-ticketing-backend-dev npm run seed-templates
```

### Option 2: Run Locally

```bash
cd server
npm run seed-templates
```

## ✅ What the Script Does

1. **Checks for existing categories** and uses them, or creates these defaults:
   - Hårdvara (Hardware)
   - Mjukvara (Software)
   - Nätverk (Network)
   - Behörighet (Access)
   - Användarhantering (User Management)
   - Allmänt (General)
   - Skrivare (Printer)

2. **Creates 7 templates** with appropriate:
   - Title templates
   - Description templates
   - Priority levels
   - Category assignments
   - Notes and solution templates

3. **Adds all dynamic fields** for each template with:
   - Field names and labels
   - Field types (text, textarea, select, date, checkbox)
   - Placeholders and default values
   - Required/optional flags
   - Dropdown options

## 📋 Template Details

### 1. Allmän IT-Support
**Use Case:** General catch-all when users don't know the specific category

**Fields:**
- Problem category (dropdown)
- Problem description (rich text)
- Affected users/department
- When did it start?
- Error message
- What have you tried?

---

### 2. Behörighetsförfrågan
**Use Case:** Requesting access to systems, folders, or applications

**Fields:**
- System/Application (dropdown)
- Access type (dropdown)
- Folder/Area path
- Business justification (rich text)
- Access period (dropdown)
- End date (if temporary)
- Manager approval

---

### 3. Programvaruinstallation
**Use Case:** Installing new software on computers

**Fields:**
- Software name
- Version
- Computer name or user ID
- Business need (rich text)
- License available? (dropdown)
- Desired installation date
- Training needed? (checkbox)

---

### 4. Lösenordsåterställning
**Use Case:** Quick password resets

**Fields:**
- System (dropdown: Windows, Email, BC, VPN)
- Username
- Last successful login
- Error message
- Account locked? (checkbox)

---

### 5. Nätverksproblem
**Use Case:** Connectivity and network issues

**Fields:**
- Issue type (dropdown)
- Location/Office
- Connection type (dropdown)
- Devices affected (dropdown)
- Which service can't you reach?
- Was it working yesterday? (checkbox)

---

### 6. Utrustningsretur / Avslut
**Use Case:** Employee offboarding and equipment returns

**Fields:**
- Employee name
- Last day of work
- Equipment to return (rich text list)
- Systems to revoke access from (rich text list)
- Forward email to
- Backup needed? (checkbox)
- Manager confirmation

---

### 7. Skrivarproblem
**Use Case:** Common printer issues

**Fields:**
- Printer name/location
- Issue type (dropdown)
- Error code
- Affects (dropdown: only me, multiple users, whole office)
- Urgent print needed? (checkbox)

---

## 🎨 Customization

After running the script, you can:

1. **Edit templates** in Settings → Ärendemallar
2. **Modify fields** in the "Dynamiska fält" tab
3. **Add new fields** using the "Lägg till fält" button
4. **Reorder fields** with up/down arrows
5. **Delete unwanted templates or fields**

## 🔍 Verification

After running the script, verify by:

1. Go to **Settings** → Scroll to **Ärendemallar**
2. You should see 7 new templates
3. Click on any template → **Dynamiska fält** tab
4. You should see multiple fields listed

## 🎯 Using the Templates

1. **Create New Ticket** → Click **"Skapa från mall"** button
2. **Select a template** from the list
3. **Fill in the dynamic fields** (now with RichTextEditor for textareas!)
4. **Add attachments and checklist** as needed
5. **Submit**

## ⚠️ Important Notes

- **Safe to re-run:** The script checks for existing categories and won't duplicate them
- **Idempotent:** Running multiple times is safe
- **No data loss:** Existing templates and tickets are not affected
- **Backup recommended:** Always backup before database changes

## 🐛 Troubleshooting

**Script fails to run:**
```bash
# Check if backend container is running
docker ps | grep it-ticketing-backend

# Check backend logs
docker logs it-ticketing-backend
```

**Templates not showing up:**
1. Refresh the browser
2. Check Settings → Ärendemallar
3. Check browser console for errors

**Fields not appearing:**
1. Make sure you're editing an existing template (not creating new)
2. Click the "Dynamiska fält" tab
3. Templates must be saved before fields can be added

## 📞 Support

If you encounter issues:
1. Check the backend logs: `docker logs it-ticketing-backend`
2. Verify database integrity: `npm run list-fields`
3. Check CLAUDE.md for additional troubleshooting

---

**Happy Ticketing! 🎉**

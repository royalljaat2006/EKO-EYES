# Deployment Script for RACK Server
# Run this script in PowerShell to deploy the project directly to the RACK server.

$ErrorActionPreference = "Stop"

# Define Server Variables
$ServerIP = "122.176.147.78"
$SSHPort = "2222"
$SSHUser = "kapil"
$RemoteDir = "/home/deepanshu"
$ArchiveName = "project.tar.gz"

Write-Host "=== Starting Deployment to RACK Server ===" -ForegroundColor Cyan

# 1. Clean up local archive if it exists
if (Test-Path $ArchiveName) {
    Remove-Item $ArchiveName
}

# 2. Compress the project (excluding node_modules, dist, git, database)
Write-Host "1. Packaging project files (excluding node_modules)..." -ForegroundColor Yellow
tar --exclude="node_modules" --exclude="dist" --exclude=".git" --exclude="*.sqlite" -czf $ArchiveName backend frontend README.md ROADMAP.md RM_DC_Contacts_TEMPLATE.xlsx template.md

# 3. Upload archive to RACK server
Write-Host "2. Uploading archive to RACK server ($ServerIP:$SSHPort)..." -ForegroundColor Yellow
scp -P $SSHPort $ArchiveName "${SSHUser}@${ServerIP}:${RemoteDir}/"

# 4. Extract archive on server and run npm install
Write-Host "3. Extracting files and installing dependencies on RACK server..." -ForegroundColor Yellow
ssh -p $SSHPort "${SSHUser}@${ServerIP}" "cd $RemoteDir && tar -xzf $ArchiveName && rm $ArchiveName && cd backend && npm install && cd ../frontend && npm install"

# 5. Clean up local archive
if (Test-Path $ArchiveName) {
    Remove-Item $ArchiveName
}

Write-Host "=== Deployment Completed Successfully! ===" -ForegroundColor Green

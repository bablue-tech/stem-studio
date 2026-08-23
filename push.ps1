$git = "C:\Program Files\Git\cmd\git.exe"
$message = if ($args[0]) { $args[0] } else { "Update" }

Write-Host "Adding all changes..." -ForegroundColor Cyan
& $git add .

Write-Host "Committing: $message" -ForegroundColor Cyan
& $git commit -m $message

Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
& $git push

Write-Host "Done! Pushed to GitHub." -ForegroundColor Green

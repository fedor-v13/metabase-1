git reset HEAD~1
rm ./backport.sh
git cherry-pick 7149fccb6ac566bee0428e4f735924f963dc2539
echo 'Resolve conflicts and force push this branch.\n\nTo backport translations run: bin/i18n/merge-translations <release-branch>'
